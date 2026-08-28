/**
 * dsh-conversation-map host half.
 *
 * The map's render data (session list, lineage, live status) already lives in
 * the browser's sessions store, so the client renders without us. What the
 * client CANNOT see is the conversation CONTENT — that is internal live data
 * the browser never receives. So the host half owns exactly one thing:
 *
 *   the digest pipeline — an LLM that turns each session's surface into a
 *   three-field theme card (概要 / 关键结论 / 下一步), persisted in a
 *   storage-domain table and served to the map over HTTP.
 *
 * Pipeline (ported from dsh-talk-map's digest design, zero-dependency):
 *   turn/end → per-session debounce → single-flight queue → readSurface →
 *   extract → hash-skip → one llm.stream call → digests table.
 * Failure degrades gracefully: previous digest fields survive, `error` is
 * set so the card can show a badge.
 *
 * Surface (HTTP, under /conversation-map — deliberately NOT /api, which
 * carries dsh's browser-trust fence):
 *   GET  /conversation-map/state        → { digests }
 *   POST /conversation-map/digest/refresh → force-regenerate one session
 *   GET  /conversation-map/events       → SSE fan-out of digest changes
 *
 * Contracts (structural, verified against deepseek-harness 0.1.1-rc.2):
 *   ctx.storageDomain.open(spec)        → { table(name), global, close }
 *   ctx.webServer.register({kind,path,handler}) → disposer
 *   ctx.sessionQuery.readSurface(id)    → { session, capturedThroughSeq, events }
 *   ctx.llm.stream({provider,model,messages,system,maxTokens,sessionId})
 *   ctx.agentDefaultModel.currentSelection() → { provider, model, ... }
 *   ctx.on('session/event', (session, event) => ...)  (event.type === 'turn/end')
 */

import { createHash } from 'node:crypto'

export const name = 'conversation-map'

const PLUGIN_TAG = '[dsh-conversation-map]'

/** Storage domain name — must match /^[a-z][a-z0-9_]*$/ (no hyphens). */
const DOMAIN_NAME = 'conversation_map'

/** Idle time before a busy session's digest is generated. */
const IDLE_MS = 30_000
/** A session needs at least this many surface messages to digest. */
const MIN_MESSAGES = 2
const MAX_MESSAGES = 40
const MAX_CHARS = 24_000

//#region minimal zod-compatible schema (passthrough)
/**
 * storage-domain validates records against `valueSchema.parse(raw)` and
 * checks `global.schema.safeParse(null)`. We deliberately keep the map
 * zero-dependency: a passthrough schema accepts any JSON, which is exactly
 * what our own writer produced. Fields are still normalized in code.
 */
function passthroughSchema() {
  return {
    parse: (value) => value,
    safeParse: (value) => ({ success: true, data: value }),
  }
}
//#endregion

//#region digest prompt (three fields, strict JSON, conversation language)
const DIGEST_SYSTEM_PROMPT = [
  'You are a conversation digester for a visual conversation map.',
  'Read the conversation transcript and output STRICT JSON, nothing else:',
  '{"summary": string, "keyFindings": string[], "nextStep": string}',
  '',
  'Rules:',
  '- Use the language the conversation itself is in (Chinese conversation → Chinese output).',
  '- summary: what this conversation is about and where it stands, ≤120 characters.',
  '- keyFindings: at most 5 short bullet strings — decisions made, facts established, artifacts produced.',
  '- nextStep: ONE imperative sentence naming the next concrete action to take, ≤40 characters.',
  '  The reader returns after days away — nextStep must be directly actionable,',
  '  never vague ("continue working" is forbidden; "run the M2 browser test" is right).',
  '- If the conversation is finished with nothing left to do, nextStep is an empty string.',
  '- Output raw JSON only: no markdown fences, no commentary.',
].join('\n')

function digestUserPrompt(transcript) {
  return `Conversation transcript (oldest first):\n\n${transcript}\n\nOutput the JSON digest now.`
}

/** Tolerant parse: strips fences, grabs the outermost object, validates shape. */
function parseDigestOutput(raw) {
  let text = typeof raw === 'string' ? raw.trim() : ''
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('digest output contains no JSON object')
  const parsed = JSON.parse(text.slice(start, end + 1))
  if (typeof parsed.summary !== 'string' || typeof parsed.nextStep !== 'string' || !Array.isArray(parsed.keyFindings)) {
    throw new Error('digest output missing required fields')
  }
  return {
    summary: parsed.summary.slice(0, 300),
    keyFindings: parsed.keyFindings
      .filter((finding) => typeof finding === 'string')
      .slice(0, 5)
      .map((finding) => finding.slice(0, 200)),
    nextStep: parsed.nextStep.slice(0, 120),
  }
}
//#endregion

//#region transcript extraction
function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        block.type === 'text' &&
        typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * Fold a session's surface into plain text for the digest call, and lift
 * the zero-cost "next step" from the last todo/write snapshot.
 */
function extractFromSurface(events, capturedThroughSeq) {
  const lines = []
  let todoNext
  let lastSeq = capturedThroughSeq ?? 0

  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq > lastSeq) lastSeq = event.seq
    if (event.type === 'user/message') {
      const message = event.data ?? {}
      // Skip tool results (role user, source kind 'tool') and non-text payloads.
      const kind = message?.source?.kind
      if (kind === 'tool') continue
      const text = textOfBlocks(message?.content)
      if (text !== '') lines.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const data = event.data ?? {}
      const text = textOfBlocks(data?.message?.content ?? data?.content)
      if (text !== '') lines.push({ role: 'assistant', text })
    } else if (event.type === 'todo/write') {
      const todos = event.data?.todos
      if (Array.isArray(todos)) {
        const open = todos.find((item) => item?.status !== 'completed')
        todoNext = open?.content // last snapshot wins; undefined clears
      }
    }
  }

  const recent = lines.slice(-MAX_MESSAGES)
  let transcript = recent
    .map((line) => `${line.role === 'user' ? 'USER' : 'ASSISTANT'}: ${line.text}`)
    .join('\n\n')
  if (transcript.length > MAX_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_CHARS)
  }

  return {
    transcript,
    ...(todoNext !== undefined && todoNext !== '' ? { todoNext } : {}),
    lastSeq,
    messageCount: recent.length,
  }
}
//#endregion

//#region digest pipeline
/**
 * Debounced, single-flight per-session digest generator.
 * - schedule(): turn/end → wait IDLE_MS → enqueue
 * - refresh(): skip the debounce, force regeneration (ignores hash)
 * - backfill(): enqueue sessions that never hit a turn/end in this process
 */
class DigestPipeline {
  constructor(services, storeReady) {
    this.services = services
    this.storeReady = storeReady
    this.timers = new Map()
    this.queue = []
    this.queued = new Set()
    this.draining = false
    this.disposed = false
  }

  start() {
    const off = this.services.on('session/event', (...args) => {
      if (this.disposed) return
      const session = args[0]
      const event = args[1]
      if (event?.type !== 'turn/end' || typeof session?.id !== 'string') return
      this.schedule(session.id)
    })
    return () => {
      this.disposed = true
      off?.()
      for (const timer of this.timers.values()) clearTimeout(timer)
      this.timers.clear()
    }
  }

  schedule(sessionId) {
    if (this.disposed) return
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      this.enqueue(sessionId)
    }, IDLE_MS)
    timer.unref?.()
    this.timers.set(sessionId, timer)
  }

  async refresh(sessionId) {
    return this.run(sessionId, { force: true })
  }

  backfill(sessionIds) {
    for (const sessionId of sessionIds) this.enqueue(sessionId)
  }

  enqueue(sessionId) {
    if (this.queued.has(sessionId)) return
    this.queued.add(sessionId)
    this.queue.push(sessionId)
    void this.drain()
  }

  async drain() {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const sessionId = this.queue.shift()
        if (sessionId === undefined) break
        this.queued.delete(sessionId)
        try {
          await this.run(sessionId, { force: false })
        } catch (error) {
          this.services.logger?.warn?.(`${PLUGIN_TAG} digest for ${sessionId} failed: ${String(error)}`)
        }
      }
    } finally {
      this.draining = false
    }
  }

  async run(sessionId, options) {
    const store = await this.storeReady
    const surface = await this.services.sessionQuery.readSurface(sessionId)
    const extracted = extractFromSurface(surface.events, surface.capturedThroughSeq)
    const previous = store.digests.get(sessionId)

    if (extracted.transcript === '' || extracted.messageCount < MIN_MESSAGES) {
      // Too little to summarize — still surface the todo fallback.
      const digest = {
        atSeq: extracted.lastSeq,
        summary: previous?.summary ?? '',
        keyFindings: previous?.keyFindings ?? [],
        nextStep: previous?.nextStep ?? '',
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
      }
      await store.digests.put(sessionId, digest)
      return digest
    }

    const inputHash = createHash('sha256').update(extracted.transcript).digest('hex')
    if (!options.force && previous?.inputHash === inputHash && previous.error === undefined) {
      return previous
    }

    const route = this.services.agentDefaultModel.currentSelection()
    try {
      const raw = await this.generate(route, extracted.transcript, sessionId)
      const parsed = parseDigestOutput(raw)
      const digest = {
        atSeq: extracted.lastSeq,
        summary: parsed.summary,
        keyFindings: parsed.keyFindings,
        nextStep: parsed.nextStep,
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
        model: `${route.provider}/${route.model}`,
        inputHash,
      }
      await store.digests.put(sessionId, digest)
      return digest
    } catch (error) {
      const digest = {
        atSeq: extracted.lastSeq,
        summary: previous?.summary ?? '',
        keyFindings: previous?.keyFindings ?? [],
        nextStep: previous?.nextStep ?? '',
        ...(extracted.todoNext !== undefined ? { todoNext: extracted.todoNext } : {}),
        generatedAt: Date.now(),
        error: String(error).slice(0, 500),
      }
      await store.digests.put(sessionId, digest)
      return digest
    }
  }

  async generate(route, transcript, sessionId) {
    const message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: digestUserPrompt(transcript) }],
      source: { kind: 'plugin', plugin: 'dsh-conversation-map' },
    }
    let text = ''
    let failure
    // Generous cap: reasoning models spend most of the budget thinking
    // before any text-delta arrives.
    for await (const chunk of this.services.llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [message],
      system: DIGEST_SYSTEM_PROMPT,
      maxTokens: 4096,
      sessionId,
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish' && chunk.reason !== undefined && chunk.reason.kind !== 'stop') {
        failure = chunk.reason.failure?.message ?? chunk.reason.kind
      }
    }
    if (failure !== undefined && failure !== 'max-tokens') throw new Error(`llm finish: ${failure}`)
    if (text.trim() === '') throw new Error(`llm produced no text${failure !== undefined ? ` (${failure})` : ''}`)
    return text
  }
}
//#endregion

//#region HTTP surface
const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true // curl / same-machine tooling
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

function tableToRecord(table) {
  const out = {}
  for (const [key, value] of table.entries()) out[key] = value
  return out
}

/**
 * Register the /conversation-map routes.
 * @returns disposer removing routes and closing SSE clients.
 */
function mountRoutes(services, storeReady, runtime) {
  const sseClients = new Set()

  const offChanged = services.on('domain/changed', (...args) => {
    const change = args[0]
    if (change?.domain !== DOMAIN_NAME || change.table !== 'digests') return
    const frame = `event: change\ndata: ${JSON.stringify(change)}\n\n`
    for (const client of sseClients) client.write(frame)
  })

  const ping = setInterval(() => {
    for (const client of sseClients) client.write(': ping\n\n')
  }, 25_000)
  ping.unref?.()

  const unregister = services.webServer.register({
    kind: 'prefix',
    path: '/conversation-map',
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      const route = `${request.method ?? 'GET'} ${url.pathname}`
      try {
        if (route === 'GET /conversation-map/state') {
          const store = await storeReady
          sendJson(response, 200, { digests: tableToRecord(store.digests) })
          return
        }

        if (route === 'GET /conversation-map/events') {
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          })
          response.write(': connected\n\n')
          sseClients.add(response)
          request.on('close', () => {
            sseClients.delete(response)
          })
          return
        }

        if (request.method === 'POST' && !sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin request refused' })
          return
        }

        if (route === 'POST /conversation-map/digest/refresh') {
          if (runtime.digest === undefined) {
            sendJson(response, 503, { error: 'digest layer unavailable (llm service missing)' })
            return
          }
          const body = await readJsonBody(request)
          const sessionId = body?.sessionId
          if (typeof sessionId !== 'string' || sessionId === '') {
            sendJson(response, 400, { error: 'sessionId required' })
            return
          }
          const digest = await runtime.digest.refresh(sessionId)
          sendJson(response, 200, { sessionId, digest })
          return
        }

        sendJson(response, 404, { error: `no such route: ${route}` })
      } catch (error) {
        services.logger?.warn?.(`${PLUGIN_TAG} ${route} failed: ${String(error)}`)
        if (!response.headersSent) {
          sendJson(response, 400, { error: String(error) })
        } else {
          response.end()
        }
      }
    },
  })

  return () => {
    clearInterval(ping)
    offChanged?.()
    for (const client of sseClients) client.end()
    sseClients.clear()
    unregister?.()
  }
}
//#endregion

//#region entry
/** Structural cordis surface at the outer (uninjected) layer. */
export function apply(ctx) {
  const runtime = {}
  let resolveStore
  let rejectStore
  const storeReady = new Promise((resolve, reject) => {
    resolveStore = resolve
    rejectStore = reject
  })
  storeReady.catch(() => {
    /* observed per-consumer; avoid unhandled rejection */
  })

  // Layer 1: storage domain + HTTP routes.
  ctx.inject(['storageDomain', 'webServer'], (services) => {
    services.effect(() => {
      let disposed = false
      let store
      const spec = {
        name: DOMAIN_NAME,
        version: 1,
        tables: {
          digests: { valueSchema: passthroughSchema() },
        },
      }
      services.storageDomain
        .open(spec)
        .then((opened) => {
          if (disposed) {
            void opened.close()
            return
          }
          // Wrap the raw domain into the typed store surface the routes and
          // pipeline consume (mirrors dsh-talk-map's openTalkMapStore).
          store = {
            domain: opened,
            digests: opened.table('digests'),
          }
          resolveStore(store)
          services.logger?.info?.(`${PLUGIN_TAG} storage domain open, routes live at /conversation-map/`)
        })
        .catch((error) => {
          services.logger?.warn?.(`${PLUGIN_TAG} storage domain failed to open: ${String(error)}`)
          rejectStore(error)
        })
      const unmountRoutes = mountRoutes(services, storeReady, runtime)
      return () => {
        disposed = true
        unmountRoutes()
        void store?.domain.close()
      }
    }, 'dsh-conversation-map: domain + routes')
  })

  // Layer 2: digest pipeline (needs the llm route and session surfaces).
  ctx.inject(['sessionQuery', 'llm', 'agentDefaultModel'], (services) => {
    services.effect(() => {
      const pipeline = new DigestPipeline(services, storeReady)
      const stop = pipeline.start()
      runtime.digest = pipeline
      // Backfill: sessions already in the workspace whose digest is missing
      // (historic conversations never hit a turn/end trigger this process).
      void storeReady
        .then(async (store) => {
          if (runtime.digest !== pipeline) return
          let sessions = []
          try {
            sessions = (await services.sessionQuery.listSessions()) ?? []
          } catch (error) {
            services.logger?.warn?.(`${PLUGIN_TAG} session listing failed: ${String(error)}`)
            return
          }
          const missing = []
          for (const record of sessions) {
            const id = record?.header?.id ?? record?.id
            if (typeof id !== 'string') continue
            const digest = store.digests.get(id)
            if (digest === undefined || digest.summary === '') missing.push(id)
          }
          pipeline.backfill(missing)
        })
        .catch(() => undefined)
      return () => {
        stop()
        if (runtime.digest === pipeline) delete runtime.digest
      }
    }, 'dsh-conversation-map: digest pipeline')
  })
}
//#endregion
