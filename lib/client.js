/**
 * dsh-conversation-map client bundle.
 *
 * Format: `window.__ModuleLoader__.load({id, factory})` — the lazy-CJS
 * registration the dsh client module system consumes (see
 * @deepseek-ai/dsh-client-modules). The ONLY external this factory
 * requires is the platform seed word "react"; everything else arrives
 * through injected cordis services (`slots`, `sessions`), so the bundle
 * stays load-order-proof and dependency-light by construction.
 *
 * Surface (registered in apply):
 * - `conversation.view` id "conversation-map" — the 地图 tab in the
 *   conversation view ring (beside 对话 / 轨迹). The tab strip projects
 *   every ring entry automatically; the session body renders the active
 *   entry only, so MapView mounts when the tab is chosen.
 * - `sidebar.footer.action` id "conversation-map" — stacked entry at the
 *   sidebar foot. Clicking it activates the 地图 tab through the chat
 *   store's setView action, captured by MapView into a module bridge on
 *   first mount. Before the first map visit in a page lifetime the bridge
 *   is absent; the button then shows a short hint pointing at the tab.
 *
 * Data discipline: every fact rendered here is a scalar leaf extracted
 * from the sessions list snapshot (`byId` summaries). The snapshot
 * objects themselves are never copied, stringified, or retained —
 * `buildForest()` is the single choke point that turns live rows into
 * owned plain data.
 *
 * v0.5 board design (frame board): the map's main design is a free-form
 * board. Every workspace (grouped by a session's cwd directory) is a
 * resizable FRAME BOX (框框): drag its title bar or border to move the
 * whole workspace, drag the bottom-right handle to stretch it bigger or
 * smaller. The conversation content — session cards — lives INSIDE the
 * frame by default and can be dragged to any position by hand. Card and
 * frame positions are persisted to localStorage and restored on reload,
 * so the board stays exactly the way you arranged it. New sessions are
 * auto-placed in their workspace frame's next grid slot; once you move
 * them, that position is remembered too.
 */

window.__ModuleLoader__.load({
  id: "dsh-conversation-map",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    //#region constants
    const PLUGIN_ID = "dsh-conversation-map";
    const VIEW_ID = "conversation-map";

    /** Card geometry (px, world coordinates) — the card face. */
    const NODE_W = 232;
    const NODE_H = 96;
    /** Grid snap for manual placement (16px, like talk-map). */
    const GRID = 16;
    /** Frame box geometry. */
    const FRAME_TITLE_H = 30;
    const FRAME_PAD = 18;
    const FRAME_MIN_W = 240;
    const FRAME_MIN_H = 132;
    const FRAME_GAP_X = 48;
    const FRAME_GAP_Y = 56;
    const COLS = 3;
    const CARD_GAP_X = 24;
    const CARD_GAP_Y = 28;
    const WORLD_PAD = 80;
    const MIN_K = 0.14;
    const MAX_K = 1.8;
    /** localStorage key for the manual board layout. */
    const LAYOUT_KEY = "dsh-conversation-map.layout";
    /** Fallback group title when a session has neither cwd nor preset. */
    const UNGROUPED_TITLE = "未分组";

    const COLORS = {
      bg: "var(--dsw-alias-bg-layer-2, #202124)",
      panel: "var(--dsw-alias-bg-base, #17181a)",
      border: "var(--dsw-alias-border-l1, #3c4043)",
      label: "var(--dsw-alias-label-primary, #e8eaed)",
      labelDim: "var(--dsw-alias-label-secondary, #9aa0a6)",
      labelFaint: "var(--dsw-alias-label-tertiary, #80868b)",
      accent: "var(--dsw-static-blue-500, #8ab4f8)",
      green: "var(--dsw-static-green-500, #81c995)",
      amber: "var(--dsw-static-amber-500, #fdd663)",
    };

    /** Low-saturation card tints (ported from dsh-talk-map's color tag
     * design): one base hue per tag via alpha, quiet on light and dark
     * themes. Colors derive from a session's cwd/preset so the same
     * workspace reads as the same hue across the board. */
    const COLOR_TAGS = [
      { id: "rose", swatch: "rgb(225 29 72 / 0.55)", fill: "rgb(225 29 72 / 0.08)", border: "rgb(225 29 72 / 0.45)" },
      { id: "amber", swatch: "rgb(217 119 6 / 0.55)", fill: "rgb(217 119 6 / 0.08)", border: "rgb(217 119 6 / 0.45)" },
      { id: "lime", swatch: "rgb(101 163 13 / 0.55)", fill: "rgb(101 163 13 / 0.08)", border: "rgb(101 163 13 / 0.45)" },
      { id: "teal", swatch: "rgb(13 148 136 / 0.55)", fill: "rgb(13 148 136 / 0.08)", border: "rgb(13 148 136 / 0.45)" },
      { id: "sky", swatch: "rgb(2 132 199 / 0.55)", fill: "rgb(2 132 199 / 0.08)", border: "rgb(2 132 199 / 0.45)" },
      { id: "violet", swatch: "rgb(124 58 237 / 0.55)", fill: "rgb(124 58 237 / 0.08)", border: "rgb(124 58 237 / 0.45)" },
      { id: "stone", swatch: "rgb(120 113 108 / 0.55)", fill: "rgb(120 113 108 / 0.08)", border: "rgb(120 113 108 / 0.45)" },
    ];
    /** Stable hue for a session: hash its cwd/preset seed. */
    function colorTagFor(node) {
      const seed = node.cwdBase !== "" ? node.cwdBase : node.preset !== "" ? node.preset : node.origin;
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return COLOR_TAGS[h % COLOR_TAGS.length];
    }
    //#endregion

    //#region module bridge — chat-store actions captured by the mounted view
    /**
     * The conversation view ring renders only the ACTIVE entry, so MapView
     * is the one place that receives the chat store's baked actions
     * (PropsStore: {useStore, actions}). The store instance lives for the
     * whole page (created once by ui-conversation's apply), so capturing
     * `actions` on first mount keeps the reference valid for the sidebar
     * button even while MapView is unmounted. Until the first mount there
     * is no live handle — the sidebar button falls back to a hint.
     */
    const bridge = { actions: null };
    //#endregion

    //#region module-level session service (bound in apply)
    let sessions = void 0;
    /** Workspace service (archiveSession etc.) — bound in apply. */
    let workspaces = void 0;
    //#endregion

    //#region tiny external store helper
    /**
     * useSyncExternalStore with a useEffect fallback for older React
     * builds that lack it. getSnapshot must return a cached value until
     * the source changes — the sessions list store guarantees that.
     */
    function useStore(store) {
      const R = React;
      if (typeof R.useSyncExternalStore === "function") {
        return R.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      }
      const [value, setValue] = R.useState(store.getSnapshot);
      R.useEffect(() => {
        setValue(store.getSnapshot());
        return store.subscribe(() => setValue(store.getSnapshot()));
      }, [store]);
      return value;
    }
    //#endregion

    //#region forest model — the single live-data choke point
    /**
     * Turn the raw SessionListState into owned plain data:
     * nodes carry only scalar leaves, edges only parent→child ids whose
     * parent is present in the same set.
     * @param state - sessions.list snapshot ({ids, byId, current,...}).
     */
    function buildForest(state) {
      const nodes = [];
      const byId = state.byId ?? {};
      const present = new Set();
      for (const id of state.ids ?? []) {
        const s = byId[id];
        if (s === void 0) continue;
        present.add(String(id));
      }
      for (const id of state.ids ?? []) {
        const s = byId[id];
        if (s === void 0) continue;
        const parentId = s.parentId !== void 0 ? String(s.parentId) : void 0;
        nodes.push({
          id: String(id),
          parentId: parentId !== void 0 && present.has(parentId) ? parentId : null,
          title: typeof s.title === "string" && s.title !== "" ? s.title : s.displayTitle,
          preset: typeof s.agentPreset === "string" ? s.agentPreset : "",
          cwd: typeof s.cwd === "string" ? s.cwd : "",
          cwdBase: typeof s.cwd === "string" && s.cwd !== "" ? s.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "",
          origin: s.origin === "subagent" ? "subagent" : "",
          running: s.running === true,
          hasPending: s.pendingInteraction != null,
          completed: s.completed === true,
          blank: s.blank === true,
          updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
        });
      }
      const children = new Map();
      const roots = [];
      for (const n of nodes) {
        if (n.parentId === null || !present.has(n.parentId)) roots.push(n);
        else {
          const list = children.get(n.parentId);
          if (list === void 0) children.set(n.parentId, [n]);
          else list.push(n);
        }
      }
      return { nodes, roots, children, current: state.current !== void 0 ? String(state.current) : null };
    }
    //#endregion

    //#region board model — workspace frames + free card placement
    function snap(value) {
      return Math.round(value / GRID) * GRID;
    }

    /** Stable workspace key for a node (its cwd directory, preset, or fallback). */
    function wsKeyOf(node) {
      if (node.cwd !== "") return node.cwd;
      if (node.preset !== "") return "preset:" + node.preset;
      return "un-grouped";
    }
    /** Display title for a workspace frame. */
    function wsTitleOf(node) {
      if (node.cwdBase !== "") return node.cwdBase;
      if (node.preset !== "") return node.preset;
      return UNGROUPED_TITLE;
    }

    /**
     * Build the board model: sessions grouped into workspace FRAMES,
     * cards freely positioned inside/around them. Persisted (saved) card
     * and frame positions win; anything without a saved position gets a
     * default grid slot inside its workspace frame. Deterministic — same
     * input + same saved layout = same board.
     *
     * @returns { groups: [{key,title,members}], frames: {key:{x,y,w,h}},
     *   positions: Map<sessionId,{x,y}>, bounds: {minX,minY,width,height} }
     */
    function buildBoard(forest, saved) {
      const savedCards = (saved && saved.cards) || {};
      const savedFrames = (saved && saved.frames) || {};
      // Sessions explicitly removed from the map (removed card / workspace).
      // They are filtered BEFORE grouping so they neither get a card nor a
      // frame — deleting a position alone would let buildBoard resurrect it.
      const hidden = (saved && saved.hidden) || {};
      // Blank (empty-log, "new session" placeholder) sessions are noise on the
      // board: dsh keeps one per workspace, their title falls back to the cwd
      // basename, so without this filter every frame shows a card named after
      // the workspace itself.
      const visibleNodes = forest.nodes.filter((n) => !hidden[n.id] && !n.blank);

      // Group by workspace (cwd directory).
      const groupMap = new Map();
      for (const n of visibleNodes) {
        const key = wsKeyOf(n);
        let g = groupMap.get(key);
        if (g === void 0) {
          g = { key, title: wsTitleOf(n), members: [] };
          groupMap.set(key, g);
        }
        g.members.push(n);
      }
      const groups = [...groupMap.values()].sort(
        (a, b) => a.title.localeCompare(b.title, "zh") || a.key.localeCompare(b.key),
      );

      // Frame rects: saved first, else auto-sized at flowing positions.
      const frames = {};
      let cursorX = WORLD_PAD;
      let cursorY = WORLD_PAD;
      for (const g of groups) {
        const savedFrame = savedFrames[g.key];
        if (savedFrame !== void 0) {
          frames[g.key] = { x: savedFrame.x, y: savedFrame.y, w: savedFrame.w, h: savedFrame.h };
          continue;
        }
        const n = g.members.length;
        const rows = Math.max(1, Math.ceil(n / COLS));
        const w = FRAME_PAD * 2 + COLS * NODE_W + (COLS - 1) * CARD_GAP_X;
        const h = FRAME_TITLE_H + FRAME_PAD * 2 + rows * NODE_H + (rows - 1) * CARD_GAP_Y;
        frames[g.key] = { x: cursorX, y: cursorY, w, h };
        cursorX += w + FRAME_GAP_X;
      }

      // Card positions: saved wins; else next grid slot inside the frame.
      const positions = new Map();
      for (const g of groups) {
        const f = frames[g.key];
        const cols = Math.max(1, Math.floor((f.w - FRAME_PAD * 2 + CARD_GAP_X) / (NODE_W + CARD_GAP_X)));
        let slot = 0;
        for (const n of g.members) {
          const savedPos = savedCards[n.id];
          if (savedPos !== void 0) {
            positions.set(n.id, { x: savedPos.x, y: savedPos.y });
            continue;
          }
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          positions.set(n.id, {
            x: f.x + FRAME_PAD + col * (NODE_W + CARD_GAP_X),
            y: f.y + FRAME_TITLE_H + FRAME_PAD + row * (NODE_H + CARD_GAP_Y),
          });
          slot++;
        }
      }

      // World bounds: union of frames and cards, with padding.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const f of Object.values(frames)) {
        minX = Math.min(minX, f.x); minY = Math.min(minY, f.y);
        maxX = Math.max(maxX, f.x + f.w); maxY = Math.max(maxY, f.y + f.h);
      }
      for (const p of positions.values()) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
      }
      if (!isFinite(minX)) { minX = WORLD_PAD; minY = WORLD_PAD; maxX = WORLD_PAD + NODE_W; maxY = WORLD_PAD + NODE_H; }

      return {
        groups,
        frames,
        positions,
        bounds: {
          minX: minX - WORLD_PAD,
          minY: minY - WORLD_PAD,
          width: maxX - minX + WORLD_PAD * 2,
          height: maxY - minY + WORLD_PAD * 2,
        },
      };
    }
    //#endregion

    //#region formatting helpers
    function truncate(text, max) {
      if (typeof text !== "string" || text === "") return "(未命名)";
      return text.length > max ? text.slice(0, max - 1) + "…" : text;
    }
    function relativeTime(ms) {
      if (!ms) return "";
      const diff = Date.now() - ms;
      if (diff < 60e3) return "刚刚";
      if (diff < 3600e3) return Math.floor(diff / 60e3) + " 分钟前";
      if (diff < 86400e3) return Math.floor(diff / 3600e3) + " 小时前";
      if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + " 天前";
      const d = new Date(ms);
      return d.getMonth() + 1 + "/" + d.getDate();
    }
    function shortId(id) {
      return typeof id === "string" && id.length > 10 ? id.slice(0, 8) + "…" : String(id);
    }
    /** True when a node passes the active filter chip. */
    function matchesFilter(node, filter) {
      if (filter === "running") return node.running;
      if (filter === "attention") return node.hasPending;
      if (filter === "sub") return node.origin === "subagent";
      return true;
    }
    function matchesQuery(node, query) {
      if (query === "") return true;
      const q = query.toLowerCase();
      return (
        (node.title !== void 0 && node.title.toLowerCase().includes(q)) ||
        node.id.toLowerCase().includes(q)
      );
    }
    //#endregion

    //#region inline SVG icon (branch glyph for the sidebar rail)
    function BranchIcon({ size, color }) {
      return React.createElement(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        React.createElement("circle", { cx: 4, cy: 3.2, r: 1.9, stroke: color, "stroke-width": 1.5 }),
        React.createElement("circle", { cx: 12, cy: 3.2, r: 1.9, stroke: color, "stroke-width": 1.5 }),
        React.createElement("circle", { cx: 8, cy: 12.4, r: 1.9, stroke: color, "stroke-width": 1.5 }),
        React.createElement("path", { d: "M4 5.1v1.2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5.1M8 8.3v2.2", stroke: color, "stroke-width": 1.5 }),
      );
    }
    //#endregion

    //#region styles
    const STYLE_CSS = `
/* Sidebar foot: the shipped container is a nowrap flex row, so plugin
 * entries sit squeezed side by side. Wrap it so each entry owns a row.
 * The attribute-substring selector survives CSS-module re-hashing; if the
 * local name ever changes this degrades to the old side-by-side layout. */
div[class*="footerActions"]{flex-wrap:wrap;row-gap:6px}
.cm-page{display:flex;flex-direction:column;min-height:0;color:${COLORS.label};font-size:13px}
.cm-toolbar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid ${COLORS.border};flex:none;flex-wrap:nowrap}
.cm-count{color:${COLORS.labelFaint};font-size:12px;white-space:nowrap}
.cm-search{flex:0 1 240px;min-width:120px;height:30px;border-radius:8px;border:1px solid ${COLORS.border};background:${COLORS.bg};color:${COLORS.label};padding:0 10px;font-size:12.5px;outline:none}
.cm-search:focus{border-color:${COLORS.accent}}
.cm-chip{height:26px;padding:0 10px;border-radius:999px;border:1px solid ${COLORS.border};background:transparent;color:${COLORS.labelDim};font-size:12px;cursor:pointer;white-space:nowrap}
.cm-chip:hover{color:${COLORS.label}}
.cm-chip[data-active="1"]{border-color:${COLORS.accent};color:${COLORS.accent};background:color-mix(in srgb, ${COLORS.accent} 12%, transparent)}
.cm-spacer{flex:1}
.cm-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid ${COLORS.border};background:${COLORS.bg};color:${COLORS.labelDim};font-size:12.5px;cursor:pointer;white-space:nowrap}
.cm-btn:hover{color:${COLORS.label};border-color:${COLORS.accent}}
.cm-body{position:relative;flex:1;min-height:0}
/* canvas wrapper: absolute so it fills .cm-body regardless of flow */
.cm-canvas-wrap{position:absolute;inset:0;width:100%;height:100%}
.cm-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}
.cm-canvas[data-dragging="1"]{cursor:grabbing}
/* workspace frame box (框框) — Quick Notes 便签卡风格：
 * 彩色头部标题条 + 纸感浅色卡片主体 + 柔和阴影 */
.cm-frame .cm-frame-body{fill:transparent;filter:none}
.cm-frame .cm-frame-label{fill:#ffffff;font-size:13px;font-weight:700;pointer-events:none;letter-spacing:.02em}
.cm-frame .cm-frame-count{fill:${COLORS.labelFaint};font-size:11px;pointer-events:none}
.cm-frame .cm-frame-note{fill:${COLORS.labelFaint};font-size:11px;pointer-events:none;letter-spacing:.06em}
.cm-frame[data-dim="1"]{opacity:.18}
/* 工作区区域也不能重叠：拖动中的框浮起，碰撞目标框高亮提示（不交换，直接挡住） */
.cm-frame[data-dragging="1"] .cm-frame-body{stroke-width:2.5}
.cm-frame[data-overlap="1"] .cm-frame-body{stroke:${COLORS.amber};stroke-width:2.5;stroke-dasharray:6 3}
/* session card */
.cm-node rect.box{fill:${COLORS.bg};stroke:${COLORS.border};stroke-width:1}
.cm-node[data-current="1"] rect.box{stroke:${COLORS.accent};stroke-width:2}
.cm-node[data-selected="1"] rect.box{stroke:${COLORS.accent};stroke-dasharray:4 3}
.cm-node[data-dim="1"]{opacity:.18}
.cm-node{cursor:grab}
/* 吸附拖动中：被拖卡片浮起 */
.cm-node[data-dragging="1"] rect.box{stroke:${COLORS.accent};stroke-width:2;filter:drop-shadow(0 6px 12px #00000055)}
.cm-node[data-dragging="1"]{opacity:.96}
/* 重叠效果：目标卡片高亮提示交换 */
.cm-node[data-overlap="1"] rect.box{stroke:${COLORS.accent};stroke-width:2.5;stroke-dasharray:6 3;filter:drop-shadow(0 0 8px color-mix(in srgb, ${COLORS.accent} 55%, transparent))}
.cm-node text.t1{fill:${COLORS.label};font-size:12.5px;font-weight:500}
.cm-node text.t2{fill:${COLORS.labelFaint};font-size:10.5px}
.cm-node text.t3{font-size:11px}
.cm-edge{fill:none;stroke:${COLORS.border};stroke-width:1.5;opacity:.85}
.cm-edge[data-dim="1"]{opacity:.12}
.cm-detail{position:absolute;top:14px;right:14px;width:280px;max-height:calc(100% - 28px);overflow:auto;border:1px solid ${COLORS.border};border-radius:12px;background:${COLORS.bg};padding:14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 12px 32px -12px #00000088}
.cm-detail h3{margin:0;font-size:13.5px;line-height:1.45;word-break:break-all}
.cm-kv{display:flex;gap:8px;font-size:12px;color:${COLORS.labelDim};align-items:baseline}
.cm-kv b{color:${COLORS.labelFaint};font-weight:500;flex:none;width:52px}
.cm-kv span{word-break:break-all;color:${COLORS.labelDim}}
.cm-digest{display:flex;flex-direction:column;gap:6px;border-top:1px dashed ${COLORS.border};padding-top:8px;margin-top:2px}
.cm-digest-empty{color:${COLORS.labelFaint};font-size:12px;line-height:1.6}
.cm-digest-h{display:inline-block;color:${COLORS.labelFaint};font-size:10.5px;font-weight:600;letter-spacing:.04em;margin-right:6px}
.cm-digest-sum{font-size:12.5px;line-height:1.55;color:${COLORS.label};word-break:break-all}
.cm-digest-sum .cm-digest-h{color:${COLORS.accent}}
.cm-findings{margin:2px 0 0;padding-left:16px;font-size:12px;line-height:1.6;color:${COLORS.labelDim}}
.cm-findings li{margin-bottom:2px}
.cm-digest-next{font-size:12.5px;line-height:1.5;color:${COLORS.label}}
.cm-digest-next .cm-digest-h{color:${COLORS.green}}
.cm-digest-err{font-size:11.5px;color:${COLORS.amber};word-break:break-all;line-height:1.5}
.cm-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.cm-openbtn{height:32px;border-radius:9px;border:1px solid ${COLORS.accent};background:color-mix(in srgb, ${COLORS.accent} 16%, transparent);color:${COLORS.accent};font-size:12.5px;cursor:pointer}
.cm-openbtn:hover{background:color-mix(in srgb, ${COLORS.accent} 26%, transparent)}
.cm-hint{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);color:${COLORS.labelFaint};text-align:center;line-height:2}
.cm-legend{position:absolute;left:16px;bottom:12px;display:flex;gap:14px;color:${COLORS.labelFaint};font-size:11.5px;align-items:center;background:color-mix(in srgb, ${COLORS.panel} 72%, transparent);padding:6px 10px;border-radius:8px;backdrop-filter:blur(4px)}
.cm-foot-wrap{position:relative;display:flex}
.cm-foot-btn{border:1px solid ${COLORS.border};background:${COLORS.bg};color:${COLORS.labelDim};cursor:pointer;border-radius:10px;transition:border-color .16s,color .16s;display:flex;align-items:center;justify-content:center;gap:8px;padding:0}
.cm-foot-btn:hover,.cm-foot-btn:focus-visible{border-color:${COLORS.accent};color:${COLORS.accent};outline:none}
.cm-foot-hint{position:absolute;bottom:calc(100% + 8px);left:0;white-space:nowrap;background:${COLORS.bg};border:1px solid ${COLORS.accent};color:${COLORS.label};border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 8px 24px -8px #00000066;z-index:20}
@keyframes cm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.cm-running-dot{animation:cm-pulse 1.6s ease-in-out infinite}
/* context menu (right-click on cards / workspace frames) */
.cm-menu{position:fixed;z-index:100;min-width:190px;border:1px solid ${COLORS.border};border-radius:10px;background:${COLORS.bg};padding:6px;display:flex;flex-direction:column;gap:2px;box-shadow:0 12px 32px -10px #00000088}
.cm-menu-title{color:${COLORS.labelFaint};font-size:11px;font-weight:600;padding:4px 8px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;border-bottom:1px dashed ${COLORS.border};margin-bottom:2px}
.cm-menu-item{border:none;background:transparent;color:${COLORS.label};font-size:12.5px;text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
.cm-menu-item:hover{background:color-mix(in srgb, ${COLORS.accent} 14%, transparent);color:${COLORS.accent}}
.cm-menu-danger{color:${COLORS.amber}}
.cm-menu-danger:hover{background:color-mix(in srgb, ${COLORS.amber} 16%, transparent);color:${COLORS.amber}}
`;
    let styleInjected = false;
    function ensureStyle() {
      if (styleInjected || typeof document === "undefined") return;
      const el = document.createElement("style");
      el.setAttribute("data-plugin", PLUGIN_ID);
      el.textContent = STYLE_CSS;
      document.head.append(el);
      styleInjected = true;
    }
    //#endregion

    //#region layout persistence (localStorage)
    /** Coerce a stored number to a finite, sane value (defensive: a corrupt
     * localStorage entry must never be able to blow up the board's bounds). */
    function saneCoord(v, fallback, maxAbs) {
      const n = typeof v === "number" ? v : NaN;
      if (!isFinite(n)) return fallback;
      if (Math.abs(n) > maxAbs) return fallback;
      return n;
    }
    function loadLayout() {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (raw === null) return { cards: {}, frames: {} };
        const data = JSON.parse(raw);
        const cards = {};
        const frames = {};
        if (data && typeof data.cards === "object") {
          for (const [id, c] of Object.entries(data.cards)) {
            if (c === null || typeof c !== "object") continue;
            cards[id] = {
              x: saneCoord(c.x, 0, 1e6),
              y: saneCoord(c.y, 0, 1e6),
            };
          }
        }
        if (data && typeof data.frames === "object") {
          for (const [key, f] of Object.entries(data.frames)) {
            if (f === null || typeof f !== "object") continue;
            frames[key] = {
              x: saneCoord(f.x, 0, 1e6),
              y: saneCoord(f.y, 0, 1e6),
              w: Math.max(FRAME_MIN_W, saneCoord(f.w, FRAME_MIN_W, 1e6)),
              h: Math.max(FRAME_MIN_H, saneCoord(f.h, FRAME_MIN_H, 1e6)),
            };
          }
        }
        // Hidden (removed-from-map) session ids survive reloads.
        const hidden = {};
        if (data && typeof data.hidden === "object") {
          for (const [id, v] of Object.entries(data.hidden)) {
            if (v === true) hidden[id] = true;
          }
        }
        return { cards, frames, hidden };
      } catch {
        return { cards: {}, frames: {} };
      }
    }
    function saveLayout(layout) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {}
    }
    //#endregion

    //#region navigation
    /**
     * Focus a session from the map. Catalog-addressed subagent children go
     * through their durable direct-parent address; ordinary sessions use
     * plain open(). Returns nothing; failures surface in the host UI.
     */
    async function navigateToSession(sessionsApi, node) {
      try {
        const known = sessionsApi.subagentAddress !== void 0 ? sessionsApi.subagentAddress(node.id) : void 0;
        if (known !== void 0) {
          sessionsApi.openSubagent(known);
          return true;
        }
        if (node.origin === "subagent" && node.parentId !== null && sessionsApi.refreshSubagents !== void 0) {
          await sessionsApi.refreshSubagents(node.parentId);
          const addr = sessionsApi.subagentAddress !== void 0 ? sessionsApi.subagentAddress(node.id) : void 0;
          if (addr !== void 0) {
            sessionsApi.openSubagent(addr);
            return true;
          }
        }
      } catch {
        // fall through to plain open — worst case the host shows its own error path
      }
      try {
        sessionsApi.open(node.id);
        return true;
      } catch {
        return false;
      }
    }
    /** After opening a session from the map, land on its 对话 view. */
    function backToChatView() {
      try {
        if (bridge.actions !== null && typeof bridge.actions.setView === "function") bridge.actions.setView(null);
      } catch {}
    }
    //#endregion

    //#region delete / archive helpers
    /**
     * Archive one session via the workspace service (dsh's delete surface:
     * hides it from every grouping surface — sidebar & map — while the log
     * and accounting slot are retained). The map's grouping is driven by the
     * live sessions list, so an archived session disappears from the board.
     */
    async function archiveSessionById(sessionId) {
      if (workspaces === void 0 || typeof workspaces.archiveSession !== "function") {
        throw new Error("workspaces service unavailable");
      }
      await workspaces.archiveSession(sessionId);
    }
    //#endregion

    //#region map node renderer — card face (resume surface)
    /**
     * Card front = resume surface (dsh-talk-map design): title, the digest's
     * 2-line summary, the actionable "下一步" line, relative time + running
     * state in the footer, a stable color tag strip on the left, and a ⟳
     * affordance top-right to regenerate the digest manually.
     *
     * Draggable: pointerdown hands over to the board's drag controller
     * (onDragStart) so a press can become a manual placement.
     */
    /** Visual width of a string: CJK-wide chars count 2 units, ASCII 1. */
    function vlen(s) {
      let n = 0;
      for (const ch of s) n += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
      return n;
    }
    /** Truncate by VISUAL width (not char count) so CJK text fits the card. */
    function fitUnits(text, maxUnits) {
      if (text === "" || vlen(text) <= maxUnits) return text;
      let n = 0, out = "";
      for (const ch of text) {
        const w = ch.codePointAt(0) > 0x2e7f ? 2 : 1;
        if (n + w > maxUnits - 1) { out += "…"; break; }
        out += ch; n += w;
      }
      return out;
    }
    /** Split text into at most two lines, each capped at `perLineUnits` visual units. */
    function clamp2Units(text, perLineUnits) {
      if (text === "") return ["", ""];
      const l1 = fitUnits(text, perLineUnits);
      if (l1 === text) return [l1, ""];
      const rest = text.slice(l1.length);
      return [l1, fitUnits(rest, perLineUnits)];
    }
    /** Split text into at most two lines of `perLine` chars (… on overflow). */
    function clamp2(text, perLine) {
      if (text === "") return ["", ""];
      if (text.length <= perLine) return [text, ""];
      if (text.length <= perLine * 2) return [text.slice(0, perLine), text.slice(perLine)];
      return [text.slice(0, perLine), text.slice(perLine, perLine * 2 - 1) + "…"];
    }
    /** Deterministic string hash → stable per-frame seed (no flicker). */
    function strHash(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    }
    /** Deterministic pseudo-random in [-1, 1). */
    function prand(seed, i) {
      const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    }
    /** Hand-drawn rounded-rect path: each edge split into segments, every
     * segment gets its own random offset → visible pen wobble. `k` = zoom so
     * the wobble stays constant in SCREEN pixels. */
    function sketchRectD(x, y, w, h, r, seed, k) {
      const amp = 4.2 / Math.max(0.12, k);
      const J = (i) => prand(seed, i) * amp;
      const r2 = Math.max(2, Math.min(r, w / 2, h / 2));
      const x0 = x + r2, x1 = x + w - r2, y0 = y + r2, y1 = y + h - r2;
      const n = 6;
      const parts = [`M ${x0} ${y}`];
      for (let i = 0; i < n; i++) {
        const sx = x0 + ((x1 - x0) * i) / n, ex = x0 + ((x1 - x0) * (i + 1)) / n;
        parts.push(`Q ${(sx + ex) / 2} ${y + J(i + 1)} ${ex} ${y}`);
      }
      parts.push(`A ${r2} ${r2} 0 0 1 ${x + w} ${y0}`);
      for (let i = 0; i < n; i++) {
        const sy = y0 + ((y1 - y0) * i) / n, ey = y0 + ((y1 - y0) * (i + 1)) / n;
        parts.push(`Q ${x + w + J(i + 11)} ${(sy + ey) / 2} ${x + w} ${ey}`);
      }
      parts.push(`A ${r2} ${r2} 0 0 1 ${x1} ${y + h}`);
      for (let i = 0; i < n; i++) {
        const sx = x1 - ((x1 - x0) * i) / n, ex = x1 - ((x1 - x0) * (i + 1)) / n;
        parts.push(`Q ${(sx + ex) / 2} ${y + h + J(i + 21)} ${ex} ${y + h}`);
      }
      parts.push(`A ${r2} ${r2} 0 0 1 ${x} ${y1}`);
      for (let i = 0; i < n; i++) {
        const sy = y1 - ((y1 - y0) * i) / n, ey = y1 - ((y1 - y0) * (i + 1)) / n;
        parts.push(`Q ${x + J(i + 31)} ${(sy + ey) / 2} ${x} ${ey}`);
      }
      parts.push(`A ${r2} ${r2} 0 0 1 ${x0} ${y}`);
      parts.push("Z");
      return parts.join(" ");
    }
    function MapNode({ p, selected, current, dim, digest, onSelect, onOpen, onRefreshDigest, onDragStart, overlap, dragging, onContextMenu }) {
      const n = p.node;
      const tag = colorTagFor(n);
      const statusColor = n.hasPending ? COLORS.amber : n.running ? COLORS.green : COLORS.border;
      const dotClass = n.running && !n.hasPending ? "cm-dot cm-running-dot" : "cm-dot";
      const summary = digest && typeof digest.summary === "string" && digest.summary !== "" ? digest.summary : n.title;
      const lines = clamp2Units(summary, 36);
      const nextStep =
        digest && digest.nextStep !== ""
          ? digest.nextStep
          : digest && typeof digest.todoNext === "string" && digest.todoNext !== ""
            ? digest.todoNext
            : "";
      const refreshing = digest && digest.error !== undefined;
      return React.createElement(
        "g",
        {
          className: "cm-node",
          transform: `translate(${p.x},${p.y})`,
          "data-current": current ? "1" : "0",
          "data-selected": selected ? "1" : "0",
          "data-dim": dim ? "1" : "0",
          "data-overlap": overlap ? "1" : "0",
          "data-dragging": dragging ? "1" : "0",
          onClick: (e) => {
            e.stopPropagation();
            onSelect(n);
          },
          onDoubleClick: (e) => {
            e.stopPropagation();
            onOpen(n);
          },
          onContextMenu: (e) => {
            if (onContextMenu !== void 0) onContextMenu(e);
          },
          onPointerDown: (e) => {
            if (onDragStart !== void 0) onDragStart(e);
          },
          style: { cursor: "grab" },
        },
        // card body + color tag strip on the left edge
        React.createElement("rect", { className: "box", width: NODE_W, height: NODE_H, rx: 12, fill: tag.fill, stroke: tag.border }),
        // status dot
        React.createElement("circle", { className: dotClass, cx: 20, cy: 18, r: 4, fill: statusColor }),
        // title (line 1)
        React.createElement("text", { className: "t1", x: 32, y: 22 }, fitUnits(n.title, 30)),
        // summary (lines 2-3), 2-line clamp
        React.createElement("text", { className: "t2", x: 32, y: 39 }, lines[0]),
        lines[1] !== "" ? React.createElement("text", { className: "t2", x: 32, y: 54 }, lines[1]) : null,
        // next step (line 4) — the ADHD field, highlighted
        nextStep !== ""
          ? React.createElement(
              "text",
              { className: "t3", x: 32, y: 72 },
              React.createElement("tspan", { fill: COLORS.accent, fontWeight: 600 }, "下一步 "),
              React.createElement("tspan", { fill: COLORS.labelDim }, fitUnits(nextStep, 27)),
            )
          : null,
        // footer: relative time + status badge + digest-error marker
        React.createElement("text", { className: "t2", x: 32, y: 89 }, relativeTime(n.updatedAt)),
        n.completed
          ? React.createElement("path", { d: `M${NODE_W - 20} ${NODE_H / 2 - 3} l3.5 3.5 l6 -7`, stroke: COLORS.green, "stroke-width": 1.8, fill: "none" })
          : null,
        n.running && !n.hasPending
          ? React.createElement(
              "g",
              null,
              React.createElement("rect", { x: NODE_W - 66, y: NODE_H - 24, width: 56, height: 17, rx: 8.5, fill: COLORS.green, "fill-opacity": 0.14 }),
              React.createElement("text", { x: NODE_W - 38, y: NODE_H - 12, "text-anchor": "middle", "dominant-baseline": "middle", fill: COLORS.green, fontSize: 10, fontWeight: 600 }, "运行中"),
            )
          : null,
        n.hasPending
          ? React.createElement(
              "g",
              null,
              React.createElement("rect", { x: NODE_W - 66, y: NODE_H - 24, width: 56, height: 17, rx: 8.5, fill: COLORS.amber, "fill-opacity": 0.14 }),
              React.createElement("text", { x: NODE_W - 38, y: NODE_H - 12, "text-anchor": "middle", "dominant-baseline": "middle", fill: COLORS.amber, fontSize: 10, fontWeight: 600 }, "待交互"),
            )
          : null,
        // overlap swap indicator — this card's slot is taken by the drag
        overlap
          ? React.createElement(
              "g",
              null,
              React.createElement("rect", { x: NODE_W / 2 - 42, y: -9, width: 84, height: 18, rx: 9, fill: COLORS.accent, "fill-opacity": 0.18, stroke: COLORS.accent, "stroke-width": 1 }),
              React.createElement("text", { x: NODE_W / 2, y: 4, "text-anchor": "middle", "dominant-baseline": "middle", fill: COLORS.accent, fontSize: 10, fontWeight: 600 }, "⇄ 交换"),
            )
          : null,
      );
    }
    //#endregion

    //#region detail card
    function DetailCard({ node, digest, onClose, onRefreshDigest }) {
      if (node === null) return null;
      const status = node.hasPending ? "等待你的输入" : node.running ? "运行中" : node.completed ? "已完成（未查看）" : "空闲";
      const statusColor = node.hasPending ? COLORS.amber : node.running ? COLORS.green : COLORS.labelFaint;
      const open = () => {
        void navigateToSession(sessions, node).then((ok) => {
          if (ok) backToChatView();
        });
      };
      const hasDigest =
        digest !== undefined &&
        ((typeof digest.summary === "string" && digest.summary !== "") ||
          (typeof digest.nextStep === "string" && digest.nextStep !== "") ||
          (Array.isArray(digest.keyFindings) && digest.keyFindings.length > 0));
      const findings = digest && Array.isArray(digest.keyFindings) ? digest.keyFindings : [];
      const summary = digest && typeof digest.summary === "string" ? digest.summary : "";
      const nextStep = digest && typeof digest.nextStep === "string" ? digest.nextStep : digest && typeof digest.todoNext === "string" ? digest.todoNext : "";
      return React.createElement(
        "div",
        { className: "cm-detail" },
        React.createElement("h3", null, node.title !== void 0 ? node.title : "(未命名会话)"),
        React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "状态"), React.createElement("span", null, React.createElement("i", { className: "cm-dot", style: { background: statusColor } }), status)),
        node.origin === "subagent"
          ? React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "来源"), React.createElement("span", null, "子代理派生会话"))
          : null,
        node.preset !== ""
          ? React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "预设"), React.createElement("span", null, node.preset))
          : null,
        node.cwdBase !== ""
          ? React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "工作区"), React.createElement("span", null, node.cwdBase))
          : null,
        React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "更新"), React.createElement("span", null, relativeTime(node.updatedAt))),
        React.createElement("div", { className: "cm-kv" }, React.createElement("b", null, "ID"), React.createElement("span", null, shortId(node.id))),
        // ---- digest block: 概要 / 关键结论 / 下一步 ----
        hasDigest
          ? React.createElement(
              "div",
              { className: "cm-digest" },
              summary !== ""
                ? React.createElement("div", { className: "cm-digest-sum" }, React.createElement("span", { className: "cm-digest-h" }, "概要"), React.createElement("span", null, summary))
                : null,
              findings.length > 0
                ? React.createElement(
                    "div",
                    null,
                    React.createElement("div", { className: "cm-digest-h" }, "关键结论"),
                    React.createElement(
                      "ul",
                      { className: "cm-findings" },
                      findings.map((f, i) => React.createElement("li", { key: i }, f)),
                    ),
                  )
                : null,
              nextStep !== ""
                ? React.createElement(
                    "div",
                    { className: "cm-digest-next" },
                    React.createElement("span", { className: "cm-digest-h" }, "下一步"),
                    React.createElement("span", null, nextStep),
                  )
                : null,
              digest.error !== undefined
                ? React.createElement("div", { className: "cm-digest-err" }, "摘要生成失败：" + digest.error.slice(0, 120))
                : null,
            )
          : React.createElement("div", { className: "cm-digest cm-digest-empty" }, "还没有摘要——点卡片右上角 ⟳ 或下方按钮生成（会话空闲后也会自动生成）。"),
        React.createElement("button", { className: "cm-openbtn", onClick: open }, "打开这个会话 →"),
        React.createElement("button", { className: "cm-btn", onClick: () => onRefreshDigest(node), style: { height: 28 } }, "⟳ 重新生成摘要"),
        React.createElement("button", { className: "cm-btn", onClick: onClose, style: { height: 28 } }, "关闭卡片"),
      );
    }
    //#endregion

    //#region map canvas — free board with workspace frames
    function MapCanvas(props) {
      const {
        model, view, setView, svgRef, selectedId, onSelectNode, onOpenNode, onRefreshDigest,
        filter, query, currentId, digests, onMoveCard, onMoveFrame, onResizeFrame, onSwapCards,
        onRemoveCard, onRemoveGroup,
      } = props;

      // --- wheel zoom (native, non-passive so ctrl+wheel stays ours)
      React.useEffect(() => {
        const svg = svgRef.current;
        if (svg === null) return;
        const onWheel = (e) => {
          e.preventDefault();
          const rect = svg.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          setView((v) => {
            const factor = Math.exp(-e.deltaY * 0.0012);
            const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
            const scale = k / v.k;
            return { k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale };
          });
        };
        svg.addEventListener("wheel", onWheel, { passive: false });
        return () => svg.removeEventListener("wheel", onWheel);
      }, [svgRef, setView]);

      // --- pan (background drag only; cards/frames stop propagation)
      const panRef = React.useRef(null);
      const startPan = (e) => {
        if (e.button !== 0) return;
        panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
        e.currentTarget.setAttribute("data-dragging", "1");
      };
      const movePan = (e) => {
        const d = panRef.current;
        if (d === null) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
        setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
      };
      const endPan = (e) => {
        const d = panRef.current;
        panRef.current = null;
        if (e.currentTarget.setAttribute) e.currentTarget.setAttribute("data-dragging", "0");
        if (d !== null && d.moved) suppressClickRef.current = true;
      };
      const bgClick = () => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onSelectNode(null);
      };

      // --- drag controller (card placement / frame move / frame resize)
      const viewRef = React.useRef(view);
      viewRef.current = view;
      const modelRef = React.useRef(model);
      modelRef.current = model;
      const cbRef = React.useRef({ onMoveCard, onMoveFrame, onResizeFrame, onSwapCards });
      cbRef.current = { onMoveCard, onMoveFrame, onResizeFrame, onSwapCards };
      const dragRef = React.useRef(null);
      const suppressClickRef = React.useRef(false);
      /** Id of the card currently being dragged (drives z-order + elevation). */
      const [dragId, setDragId] = React.useState(null);
      /** Id of the card whose slot the dragged card currently overlaps. */
      const [overlapId, setOverlapId] = React.useState(null);
      /** Key of the frame currently being dragged. */
      const [dragFrameKey, setDragFrameKey] = React.useState(null);
      /** Key of the frame the dragged frame currently overlaps (swap target). */
      const [overlapFrameKey, setOverlapFrameKey] = React.useState(null);

      /** AABB intersection — the 不能重叠 test for cards and frames alike. */
      const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
        ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

      const toFlow = (clientX, clientY) => {
        const rect = svgRef.current === null ? null : svgRef.current.getBoundingClientRect();
        if (rect === null) return { x: 0, y: 0 };
        const v = viewRef.current;
        return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
      };

      /**
       * Snap a dragged card INSIDE its workspace frame (卡片只能在框内活动):
       * while dragging, the card magnetically aligns to the frame's slot grid,
       * and its rect is clamped to the frame bounds — any edge touching the
       * border sticks there (任一边缘出框即吸附在边框), the card can never
       * leave the workspace box. Returns the snapped top-left position and,
       * if that position would overlap another card (不能重叠), that card's id
       * as the swap target — on release the occupant takes the dragged card's
       * original slot so no two cards ever stack.
       */
      const snapCardPosition = (id, x, y) => {
        const m = modelRef.current;
        const group = m.groups.find((g) => g.members.some((n) => n.id === id));
        let tx;
        let ty;
        const f = group === undefined ? void 0 : m.frames[group.key];
        if (f !== void 0) {
          const cellW = NODE_W + CARD_GAP_X;
          const cellH = NODE_H + CARD_GAP_Y;
          // Snap to the nearest slot of the frame's grid.
          const cx = x + NODE_W / 2;
          const cy = y + NODE_H / 2;
          const col = Math.max(0, Math.round((cx - (f.x + FRAME_PAD)) / cellW));
          const row = Math.max(0, Math.round((cy - (f.y + FRAME_TITLE_H + FRAME_PAD)) / cellH));
          tx = f.x + FRAME_PAD + col * cellW;
          ty = f.y + FRAME_TITLE_H + FRAME_PAD + row * cellH;
          // Clamp INSIDE the frame: left/top ≥ frame origin (below the title
          // bar), right/bottom ≤ frame edges. Any edge that would poke out is
          // pulled back to the border — the card can never leave the box.
          tx = Math.max(f.x, Math.min(f.x + f.w - NODE_W, tx));
          ty = Math.max(f.y + FRAME_TITLE_H, Math.min(f.y + f.h - NODE_H, ty));
        } else {
          tx = snap(x);
          ty = snap(y);
        }
        // 不能重叠: any card whose rect intersects the snapped rect is the
        // swap target (frame members normally; free-placed cards too).
        let occupantId = null;
        for (const [cid, pos] of m.positions) {
          if (cid === id) continue;
          if (
            tx < pos.x + NODE_W && tx + NODE_W > pos.x &&
            ty < pos.y + NODE_H && ty + NODE_H > pos.y
          ) {
            occupantId = cid;
            break;
          }
        }
        return { x: tx, y: ty, occupantId };
      };

      React.useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current;
          if (d === null) return;
          if (Math.abs(e.clientX - d.scx) > 3 || Math.abs(e.clientY - d.scy) > 3) d.moved = true;
          if (!d.moved) return;
          const p = toFlow(e.clientX, e.clientY);
          const dx = p.x - d.sx;
          const dy = p.y - d.sy;
          const cb = cbRef.current;
          if (d.kind === "card") {
            const snapped = snapCardPosition(d.id, d.ox + dx, d.oy + dy);
            d.overlapId = snapped.occupantId;
            setOverlapId(snapped.occupantId);
            cb.onMoveCard(d.id, snapped.x, snapped.y);
          } else if (d.kind === "frame") {
            // 工作区区域也不能重叠：碰撞阻挡（不做交换）。增量分解式
            // 钳制——水平/垂直各算出「最多能拖到哪」，让被拖框永远不
            // 与任何其他框重叠（保留 8px 间隙）。
            const m = modelRef.current;
            const fw = d.ow ?? m.frames[d.key]?.w ?? 0;
            const fh = d.oh ?? m.frames[d.key]?.h ?? 0;
            const GAP = 8;
            const others = Object.entries(m.frames).filter(([key]) => key !== d.key);
            // 原始目标位置用于碰撞提示（目标框高亮 + 「碰撞」徽章）
            const rawX = d.ox + dx;
            const rawY = d.oy + dy;
            let frameHit = null;
            for (const g of m.groups) {
              if (g.key === d.key) continue;
              const of = m.frames[g.key];
              if (of === void 0) continue;
              if (rectsOverlap(rawX, rawY, fw, fh, of.x, of.y, of.w, of.h)) {
                frameHit = g.key;
                break;
              }
            }
            d.overlapFrameKey = frameHit;
            setOverlapFrameKey(frameHit);
            // Axis-by-axis clamp, two passes: clamp X given current Y, then
            // clamp Y given clamped X, repeat once so corners resolve too.
            let cdx = dx;
            let cdy = dy;
            for (let pass = 0; pass < 2; pass++) {
              // --- horizontal clamp ---
              let tx = d.ox + cdx;
              for (const [, of] of others) {
                const yOv = d.oy + cdy < of.y + of.h && d.oy + cdy + fh > of.y;
                if (!yOv) continue;
                if (tx + fw <= of.x) {
                  // frame entirely left of the target: max X stops at its left edge
                  const maxX = of.x - GAP - fw;
                  if (tx > maxX) tx = maxX;
                } else if (tx >= of.x + of.w) {
                  // frame entirely right of the target: min X stops at its right edge
                  const minX = of.x + of.w + GAP;
                  if (tx < minX) tx = minX;
                } else {
                  // already horizontally overlapped: eject to the nearer side
                  tx = tx + fw / 2 < of.x + of.w / 2 ? of.x - GAP - fw : of.x + of.w + GAP;
                }
              }
              cdx = tx - d.ox;
              // --- vertical clamp ---
              let ty = d.oy + cdy;
              for (const [, of] of others) {
                const xOv = d.ox + cdx < of.x + of.w && d.ox + cdx + fw > of.x;
                if (!xOv) continue;
                if (ty + fh <= of.y) {
                  const maxY = of.y - GAP - fh;
                  if (ty > maxY) ty = maxY;
                } else if (ty >= of.y + of.h) {
                  const minY = of.y + of.h + GAP;
                  if (ty < minY) ty = minY;
                } else {
                  ty = ty + fh / 2 < of.y + of.h / 2 ? of.y - GAP - fh : of.y + of.h + GAP;
                }
              }
              cdy = ty - d.oy;
            }
            cb.onMoveFrame(d.key, d.ox, d.oy, d.members, cdx, cdy);
          } else if (d.kind === "resize") {
            const rect = resizeRectFor(d, dx, dy);
            cb.onResizeFrame(d.key, rect.x, rect.y, rect.w, rect.h);
          }
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          setDragId(null);
          setOverlapId(null);
          setDragFrameKey(null);
          setOverlapFrameKey(null);
          if (d === null) return;
          if (d.moved) suppressClickRef.current = true;
          // Overlap on a frame slot → swap: the occupant takes the dragged
          // card's original slot, the dragged card stays on the target slot.
          if (d.kind === "card" && d.overlapId != null) {
            cbRef.current.onSwapCards(d.id, d.overlapId, { x: d.ox, y: d.oy });
          }
          // Frame collisions are handled during the drag by clamping the
          // position (碰撞阻挡) — no swap on release.
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [svgRef]);

      const startDrag = (e, kind, payload) => {
        e.stopPropagation();
        e.preventDefault();
        const p = toFlow(e.clientX, e.clientY);
        dragRef.current = { kind, ...payload, overlapId: null, overlapFrameKey: null, sx: p.x, sy: p.y, scx: e.clientX, scy: e.clientY, moved: false };
        setDragId(kind === "card" ? payload.id : null);
        setDragFrameKey(kind === "frame" ? payload.key : null);
      };

      const startFrameDrag = (e, g) => {
        const f = modelRef.current.frames[g.key];
        if (f === void 0) return;
        const members = g.members
          .map((n) => {
            const p = modelRef.current.positions.get(n.id);
            return p === void 0 ? null : { id: n.id, x: p.x, y: p.y };
          })
          .filter((m) => m !== null);
        startDrag(e, "frame", { key: g.key, ox: f.x, oy: f.y, ow: f.w, oh: f.h, members });
      };
      const startResizeDrag = (e, g, dir) => {
        const f = modelRef.current.frames[g.key];
        if (f === void 0) return;
        startDrag(e, "resize", { key: g.key, dir, ox: f.x, oy: f.y, ow: f.w, oh: f.h });
      };

      // ---- context menu (right-click): remove cards / workspace frames ----
      const [menu, setMenu] = React.useState(null);
      const closeMenu = () => setMenu(null);
      const openCardMenu = (event, card) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ kind: "card", sessionId: card.sessionId, title: card.title, x: event.clientX, y: event.clientY });
      };
      const openFrameMenu = (event, group) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ kind: "frame", groupKey: group.key, title: group.title, x: event.clientX, y: event.clientY });
      };
      // Close on any outside click / Escape.
      React.useEffect(() => {
        if (menu === null) return;
        const onDown = (e) => {
          if (e.target !== null && e.target.closest !== undefined && e.target.closest(".cm-menu") !== null) return;
          closeMenu();
        };
        const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
        window.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey, true);
        return () => {
          window.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey, true);
        };
      }, [menu]);

      /**
       * Direction-aware resize (鼠标移到边框即可拉大拉小): the dragged edge
       * follows the pointer while the opposite edge stays anchored. The
       * frame can NEVER shrink below the area its member cards actually
       * occupy (content bounds + padding + title bar) — 会话不会被挤出边框 —
       * and it also stays away from other frames so 工作区区域 never overlap.
       */
      const resizeRectFor = (d, dx, dy) => {
        const dir = d.dir;
        // Content floor: the tightest rect (frame-relative padding) that
        // still fully contains every member card still INSIDE the frame.
        // Cards dragged out of the frame no longer stretch it — 会话可以移出
        // 边框，框不会追着外移的卡片变大。Auto-grid cards reflow with frame
        // width, so shrinking width raises the height floor — content stays in.
        const group = modelRef.current.groups.find((g) => g.key === d.key);
        const frameCur = modelRef.current.frames[d.key];
        let cMinX = -Infinity;
        let cMinY = -Infinity;
        let cMaxX = Infinity;
        let cMaxY = Infinity;
        if (group !== void 0 && frameCur !== void 0) {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const n of group.members) {
            const pos = modelRef.current.positions.get(n.id);
            if (pos === void 0) continue;
            // Skip cards whose center is outside the frame's current rect —
            // they were deliberately moved out and must not stretch the frame.
            const ccx = pos.x + NODE_W / 2;
            const ccy = pos.y + NODE_H / 2;
            if (ccx < frameCur.x || ccx > frameCur.x + frameCur.w || ccy < frameCur.y || ccy > frameCur.y + frameCur.h) continue;
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + NODE_W);
            maxY = Math.max(maxY, pos.y + NODE_H);
          }
          if (isFinite(minX)) {
            cMinX = minX - FRAME_PAD;
            cMinY = minY - FRAME_PAD - FRAME_TITLE_H;
            cMaxX = maxX + FRAME_PAD;
            cMaxY = maxY + FRAME_PAD;
          }
        }

        // Dragged edges follow the pointer, clamped to the content floor;
        // opposite edges stay anchored. Content floor only applies when the
        // member cards' bounds are actually known.
        const hasContent = isFinite(cMinX) && isFinite(cMaxX);
        let x = d.ox;
        let y = d.oy;
        let w = d.ow;
        let h = d.oh;
        if (dir.includes("w")) x = hasContent ? Math.min(d.ox + dx, cMinX) : d.ox + dx;
        if (dir.includes("n")) y = hasContent ? Math.min(d.oy + dy, cMinY) : d.oy + dy;
        if (dir.includes("e")) w = hasContent ? Math.max(d.ow + dx, cMaxX - d.ox) : d.ow + dx;
        if (dir.includes("s")) h = hasContent ? Math.max(d.oh + dy, cMaxY - d.oy) : d.oh + dy;
        // Anchored edges: when the left/top edge moves, the right/bottom
        // edge keeps its absolute position.
        if (dir.includes("w")) w = d.ox + d.ow - x;
        if (dir.includes("n")) h = d.oy + d.oh - y;

        // Absolute min-size floor (rarely hit — content floor is bigger).
        if (w < FRAME_MIN_W) {
          if (dir.includes("w")) x = d.ox + d.ow - FRAME_MIN_W;
          w = FRAME_MIN_W;
        }
        if (h < FRAME_MIN_H) {
          if (dir.includes("n")) y = d.oy + d.oh - FRAME_MIN_H;
          h = FRAME_MIN_H;
        }
        // Keep away from other frames (small gap), settling over two passes.
        // Content floor wins over neighbor avoidance: a frame may touch a
        // neighbor rather than squeeze its own cards out.
        const GAP = 8;
        const others = Object.entries(modelRef.current.frames).filter(([key]) => key !== d.key);
        for (let pass = 0; pass < 2; pass++) {
          for (const [, of] of others) {
            const hOverlap = x < of.x + of.w && x + w > of.x;
            const vOverlap = y < of.y + of.h && y + h > of.y;
            if (!hOverlap || !vOverlap) continue;
            if (dir.includes("e") && of.x > x) {
              const limit = of.x - GAP - x;
              const floor = hasContent ? Math.max(FRAME_MIN_W, cMaxX - x) : FRAME_MIN_W;
              if (w > limit && limit >= floor) w = limit;
            }
            if (dir.includes("w") && of.x + of.w < x + w) {
              const limit = of.x + of.w + GAP;
              const w2 = d.ox + d.ow - limit;
              const floor = hasContent ? Math.max(FRAME_MIN_W, cMaxX - x) : FRAME_MIN_W;
              if (w2 >= floor && x < limit) { x = limit; w = w2; }
            }
            if (dir.includes("s") && of.y > y) {
              const limit = of.y - GAP - y;
              const floor = hasContent ? Math.max(FRAME_MIN_H, cMaxY - y) : FRAME_MIN_H;
              if (h > limit && limit >= floor) h = limit;
            }
            if (dir.includes("n") && of.y + of.h < y + h) {
              const limit = of.y + of.h + GAP;
              const h2 = d.oy + d.oh - limit;
              const floor = hasContent ? Math.max(FRAME_MIN_H, cMaxY - y) : FRAME_MIN_H;
              if (h2 >= floor && y < limit) { y = limit; h = h2; }
            }
          }
        }
        // Final content-floor safety net (in case neighbor clamps shrank us).
        if (hasContent) {
          if (x + w < cMaxX) w = cMaxX - x;
          if (y + h < cMaxY) h = cMaxY - y;
          if (x > cMinX) x = cMinX;
          if (y > cMinY) y = cMinY;
        }
        // Snap to the grid, then re-apply the floor so rounding never cuts
        // into the content area (会话不能被挤出边框).
        let rx = snap(x);
        let ry = snap(y);
        let rw = Math.max(FRAME_MIN_W, snap(w));
        let rh = Math.max(FRAME_MIN_H, snap(h));
        if (hasContent) {
          if (rx > cMinX) rx = cMinX;
          if (ry > cMinY) ry = cMinY;
          if (rx + rw < cMaxX) rw = Math.ceil((cMaxX - rx) / GRID) * GRID;
          if (ry + rh < cMaxY) rh = Math.ceil((cMaxY - ry) / GRID) * GRID;
        }
        return { x: rx, y: ry, w: Math.max(FRAME_MIN_W, rw), h: Math.max(FRAME_MIN_H, rh) };
      };

      const q = query.trim().toLowerCase();
      const visible = (n) => matchesFilter(n, filter) && matchesQuery(n, q);

      // parent→child lineage edges (bezier between card centers)
      const byId = new Map();
      for (const n of model.groups.flatMap((g) => g.members)) byId.set(n.id, n);
      const edges = [];
      for (const n of byId.values()) {
        if (n.parentId === null) continue;
        const parent = byId.get(n.parentId);
        const pp = parent !== void 0 ? model.positions.get(parent.id) : void 0;
        const p = model.positions.get(n.id);
        if (pp === void 0 || p === void 0) continue;
        const bothVisible = visible(n) && visible(parent);
        const x1 = pp.x + NODE_W / 2;
        const y1 = pp.y + NODE_H / 2;
        const x2 = p.x + NODE_W / 2;
        const y2 = p.y + NODE_H / 2;
        const my = (y1 + y2) / 2;
        edges.push(
          React.createElement("path", {
            key: "e" + n.id,
            className: "cm-edge",
            "data-dim": bothVisible ? "0" : "1",
            d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
          }),
        );
      }

      // workspace frames (框框) — Quick Notes 便签卡风格:
      // 顶部彩色标题条（拖拽移动）+ 纸感浅色卡片主体（会话内容在其上）
      const frameEls = [];
      for (const g of model.groups) {
        const f = model.frames[g.key];
        if (f === void 0) continue;
        const tag = colorTagFor(g.members[0] ?? { cwdBase: g.title, preset: "", origin: "" });
        const anyVisible = g.members.some(visible);
        const title = truncate(g.title, 22);
        const count = g.members.length;
        // 便签头部条：主题色（按工作区 cwd 哈希的稳定色），上圆下方
        const headH = FRAME_TITLE_H;
        frameEls.push(
          React.createElement(
            "g",
            {
              key: "frame-" + g.key,
              className: "cm-frame",
              "data-dim": anyVisible ? "0" : "1",
              "data-overlap": overlapFrameKey === g.key ? "1" : "0",
              "data-dragging": dragFrameKey === g.key ? "1" : "0",
              onClick: (e) => { e.stopPropagation(); },
              onContextMenu: (e) => openFrameMenu(e, g),
            },
            // 卡片主体 — 透明背景 + 主题色边框（跟随色带，无阴影）
            React.createElement("rect", {
              className: "cm-frame-body", x: f.x, y: f.y, width: f.w, height: f.h, rx: 14,
              fill: "none", stroke: tag.border, "stroke-width": 2,
              style: { pointerEvents: "none" },
            }),
            // 便签彩色头部条 — 上圆下方色带，拖拽移动整个工作区
            React.createElement("path", {
              d: `M ${f.x + 14} ${f.y} L ${f.x + f.w - 14} ${f.y} Q ${f.x + f.w} ${f.y} ${f.x + f.w} ${f.y + 14} L ${f.x + f.w} ${f.y + headH} L ${f.x} ${f.y + headH} L ${f.x} ${f.y + 14} Q ${f.x} ${f.y} ${f.x + 14} ${f.y} Z`,
              style: { fill: tag.swatch, stroke: tag.border, strokeWidth: 1, cursor: "grab" },
              onPointerDown: (e) => startFrameDrag(e, g),
            }),
            // 标题文字（白色，位于头部条内左侧）
            React.createElement("text", { className: "cm-frame-label", x: f.x + 14, y: f.y + headH / 2 + 4.5, style: { filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" } }, fitUnits(title, Math.max(6, Math.floor((f.w - 130) / 7)))),
            // 卡片底部角落的小标签（便签纸风格）
            React.createElement("text", { className: "cm-frame-note", x: f.x + 14, y: f.y + f.h - 10 }, "WORKSPACE"),
            // resize strips — 鼠标移到边框即可拉大拉小: four edges + four
            // corners, each with the matching resize cursor.
            React.createElement("rect", { x: f.x + 10, y: f.y - 5, width: f.w - 20, height: 10, fill: "transparent", style: { cursor: "ns-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "n") }),
            React.createElement("rect", { x: f.x + 10, y: f.y + f.h - 5, width: f.w - 20, height: 10, fill: "transparent", style: { cursor: "ns-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "s") }),
            React.createElement("rect", { x: f.x - 5, y: f.y + 10, width: 10, height: f.h - 20, fill: "transparent", style: { cursor: "ew-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "w") }),
            React.createElement("rect", { x: f.x + f.w - 5, y: f.y + 10, width: 10, height: f.h - 20, fill: "transparent", style: { cursor: "ew-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "e") }),
            React.createElement("rect", { x: f.x - 7, y: f.y - 7, width: 14, height: 14, fill: "transparent", style: { cursor: "nwse-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "nw") }),
            React.createElement("rect", { x: f.x + f.w - 7, y: f.y - 7, width: 14, height: 14, fill: "transparent", style: { cursor: "nesw-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "ne") }),
            React.createElement("rect", { x: f.x - 7, y: f.y + f.h - 7, width: 14, height: 14, fill: "transparent", style: { cursor: "nesw-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "sw") }),
            React.createElement("rect", { x: f.x + f.w - 7, y: f.y + f.h - 7, width: 14, height: 14, fill: "transparent", style: { cursor: "nwse-resize", pointerEvents: "all" }, onPointerDown: (e) => startResizeDrag(e, g, "se") }),
            // collision indicator — this frame blocks the dragged frame
            // (碰撞：不能放到这里)
            overlapFrameKey === g.key
              ? React.createElement(
                  "g",
                  null,
                  React.createElement("rect", { x: f.x + f.w / 2 - 42, y: f.y + FRAME_TITLE_H + 4, width: 84, height: 18, rx: 9, fill: COLORS.amber, "fill-opacity": 0.22, stroke: COLORS.amber, "stroke-width": 1 }),
                  React.createElement("text", { x: f.x + f.w / 2, y: f.y + FRAME_TITLE_H + 17, "text-anchor": "middle", "dominant-baseline": "middle", fill: COLORS.amber, fontSize: 10, fontWeight: 600 }, "碰撞"),
                )
              : null,
          ),
        );
      }
      // The dragged frame rides on top so the overlap swap reads clearly.
      if (dragFrameKey !== null) {
        const idx = frameEls.findIndex((el) => el.key === "frame-" + dragFrameKey);
        if (idx > -1) {
          const [lifted] = frameEls.splice(idx, 1);
          frameEls.push(lifted);
        }
      }

      // session cards — draggable for manual placement
      const nodeEls = [];
      for (const n of byId.values()) {
        const p = model.positions.get(n.id);
        if (p === void 0) continue;
        nodeEls.push(
          React.createElement(MapNode, {
            key: n.id,
            p: { x: p.x, y: p.y, node: n },
            selected: selectedId === n.id,
            current: currentId === n.id,
            dim: !visible(n),
            digest: digests[n.id],
            overlap: overlapId === n.id,
            dragging: dragId === n.id,
            onSelect: (nd) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onSelectNode(nd);
            },
            onOpen: onOpenNode,
            onRefreshDigest,
            onDragStart: (e) => startDrag(e, "card", { id: n.id, ox: p.x, oy: p.y }),
            onContextMenu: (e) => openCardMenu(e, n),
          }),
        );
      }
      // The dragged card rides on top so the overlap swap reads clearly.
      if (dragId !== null) {
        const idx = nodeEls.findIndex((el) => el.key === dragId);
        if (idx > -1) {
          const [lifted] = nodeEls.splice(idx, 1);
          nodeEls.push(lifted);
        }
      }

      return React.createElement(
        "div",
        { className: "cm-canvas-wrap" },
        React.createElement(
          "svg",
          {
            ref: svgRef,
            className: "cm-canvas",
            "data-dragging": "0",
            onPointerDown: startPan,
            onPointerMove: movePan,
            onPointerUp: endPan,
            onPointerLeave: endPan,
            onClick: bgClick,
            onContextMenu: (e) => { e.preventDefault(); closeMenu(); },
          },
          React.createElement(
            "defs",
            null,
            React.createElement("pattern", { id: "cm-grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" },
              React.createElement("path", { d: "M 24 0 L 0 0 0 24", fill: "none", stroke: "color-mix(in srgb, var(--dsw-alias-label-tertiary, #80868b) 16%, transparent)", "stroke-width": 1 }),
            ),
            // 圆珠笔手绘感：低频噪声 + 较大位移 → 长波浪、明显手抖
            React.createElement("filter", { id: "cm-pen", x: "-12%", y: "-12%", width: "124%", height: "124%" },
              React.createElement("feTurbulence", { type: "fractalNoise", baseFrequency: "0.018", numOctaves: "3", seed: "7", result: "n" }),
              React.createElement("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: "3.6" }),
            ),
          ),
          React.createElement(
            "g",
            { transform: `translate(${view.x},${view.y}) scale(${view.k})` },
            // 格子本背景 — 铺满整个可平移世界的网格纸
            React.createElement("rect", { x: -20000, y: -20000, width: 40000, height: 40000, fill: "url(#cm-grid)", style: { pointerEvents: "none" } }),
            frameEls,
            edges,
            nodeEls,
          ),
        ),
        // context menu overlay — DOM sibling of the SVG (an HTML div inside
        // <svg> would be ignored), fixed at the cursor's viewport position.
        menu !== null
          ? React.createElement(
              "div",
              {
                className: "cm-menu",
                style: { left: menu.x, top: menu.y },
                onClick: (e) => e.stopPropagation(),
              },
              React.createElement("div", { className: "cm-menu-title" }, menu.title),
              menu.kind === "card"
                ? React.createElement(
                    "button",
                    {
                      className: "cm-menu-item",
                      onClick: () => {
                        const sid = menu.sessionId;
                        closeMenu();
                        void onRemoveCard(sid, false);
                      },
                    },
                    "从地图移除",
                  )
                : null,
              menu.kind === "card"
                ? React.createElement(
                    "button",
                    {
                      className: "cm-menu-item cm-menu-danger",
                      onClick: () => {
                        const sid = menu.sessionId;
                        closeMenu();
                        void onRemoveCard(sid, true);
                      },
                    },
                    "删除会话（归档）",
                  )
                : null,
              menu.kind === "frame"
                ? React.createElement(
                    "button",
                    {
                      className: "cm-menu-item",
                      onClick: () => {
                        const key = menu.groupKey;
                        closeMenu();
                        void onRemoveGroup(key, false);
                      },
                    },
                    "移除工作区（地图上）",
                  )
                : null,
              menu.kind === "frame"
                ? React.createElement(
                    "button",
                    {
                      className: "cm-menu-item cm-menu-danger",
                      onClick: () => {
                        const key = menu.groupKey;
                        closeMenu();
                        void onRemoveGroup(key, true);
                      },
                    },
                    "删除工作区及全部会话（归档）",
                  )
                : null,
            )
          : null,
      );
    }
    //#endregion

    //#region persistent map UI state (survives tab switches within a page load)
    const mapState = {
      view: { x: 0, y: 0, k: 1 },
      selectedId: null,
      filter: "all",
      query: "",
      fitted: false,
    };
    //#endregion

    //#region the 地图 view page (conversation.view entry)
    /**
     * Props arrive from the conversation.view render share: the standard
     * session kit plus the chat-store seat ({useStore, actions}). Only
     * `actions` is consumed — captured into the module bridge so the
     * sidebar button can activate this tab later.
     *
     * Layout: the conversation area is a content-sized scrollport, so the
     * page cannot rely on parent height. On first paint it measures its own
     * in-flow rect (which IS the content region below the tab strip) and
     * pins itself `position:fixed` over that region down to the window
     * bottom — the composer stays underneath. This is the "fullscreen
     * inside the sub-page" behavior. Canvas size tracks a ResizeObserver
     * on the body.
     */
    function MapView(props) {
      const list = sessions.list;
      const snap_ = useStore(list);

      // ---- board layout: manual card/frame positions, persisted ----
      const [layout, setLayout] = React.useState(loadLayout);
      const layoutRef = React.useRef(layout);
      layoutRef.current = layout;
      const saveTimer = React.useRef(null);
      React.useEffect(
        () => () => {
          if (saveTimer.current !== null) clearTimeout(saveTimer.current);
          saveLayout(layoutRef.current);
        },
        [],
      );
      const commitLayout = (updater) => {
        setLayout((prev) => {
          const next = updater(prev);
          if (saveTimer.current !== null) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => saveLayout(next), 400);
          return next;
        });
      };
      const onMoveCard = React.useCallback((id, x, y) => {
        commitLayout((prev) => ({
          ...prev,
          cards: { ...prev.cards, [id]: { x, y } },
        }));
      }, []);
      // Frame ops fall back to the live model's rect when the frame was
      // never saved yet (auto-created): the first drag pins it into layout.
      const modelRef = React.useRef(null);
      const onMoveFrame = React.useCallback((key, ox, oy, members, dx, dy) => {
        commitLayout((prev) => {
          const cur = prev.frames[key] ?? modelRef.current?.frames[key];
          if (cur === void 0) return prev;
          // NO grid snap here: the drag already clamped the position exactly
          // against other frames (碰撞阻挡), snapping would re-introduce
          // overlaps. Cards follow with the same exact delta.
          const frames = { ...prev.frames, [key]: { x: ox + dx, y: oy + dy, w: cur.w, h: cur.h } };
          const cards = { ...prev.cards };
          for (const m of members) cards[m.id] = { x: m.x + dx, y: m.y + dy };
          // Keep every other layout field (hidden set included) — dropping
          // them here would resurrect removed workspaces on any frame drag.
          return { ...prev, cards, frames };
        });
      }, []);
      const onResizeFrame = React.useCallback((key, x, y, w, h) => {
        commitLayout((prev) => {
          const cur = prev.frames[key] ?? modelRef.current?.frames[key];
          if (cur === void 0) return prev;
          return {
            ...prev,
            frames: { ...prev.frames, [key]: { x, y, w, h } },
          };
        });
      }, []);
      /**
       * 不能重叠 swap: the dragged card already landed on the target slot
       * (onMoveCard ran live during the drag); move the occupant to the
       * dragged card's original position so no two cards ever stack.
       */
      const onSwapCards = React.useCallback((draggedId, occupantId, fromPos) => {
        commitLayout((prev) => {
          const occupantCur = prev.cards[occupantId] ?? modelRef.current?.positions.get(occupantId);
          if (occupantCur === void 0) return prev;
          const cards = { ...prev.cards };
          cards[occupantId] = { x: snap(fromPos.x), y: snap(fromPos.y) };
          return { ...prev, cards };
        });
        void draggedId; // the dragged card's target position was already saved
      }, []);

      /**
       * Remove one card from the map (its session stays untouched). The
       * session is also archived when `archive` is set — it then disappears
       * from the map AND the sidebar (log retained, per dsh's delete surface).
       * layout.cards is keyed by session id directly (see onMoveCard).
       */
      const onRemoveCard = React.useCallback(async (sessionId, archive) => {
        commitLayout((prev) => {
          const cards = { ...prev.cards };
          delete cards[sessionId];
          const hidden = { ...(prev.hidden ?? {}) };
          hidden[sessionId] = true; // blocks buildBoard from resurrecting it
          return { ...prev, cards, hidden };
        });
        if (archive) {
          try {
            await archiveSessionById(sessionId);
          } catch {
            // session archived elsewhere or service missing — map removal stands
          }
        }
      }, []);
      /**
       * Remove one workspace frame from the map, including every member card.
       * When `archive` is set, all member sessions are archived too (they
       * disappear from sidebar & map; logs retained).
       */
      const onRemoveGroup = React.useCallback(async (groupKey, archive) => {
        const group = modelRef.current?.groups.find((g) => g.key === groupKey);
        const memberIds = group === void 0 ? [] : group.members.map((n) => n.id);
        commitLayout((prev) => {
          const cards = { ...prev.cards };
          const hidden = { ...(prev.hidden ?? {}) };
          for (const id of memberIds) {
            delete cards[id];
            hidden[id] = true;
          }
          const frames = { ...prev.frames };
          delete frames[groupKey];
          return { cards, frames, hidden };
        });
        if (archive) {
          for (const id of memberIds) {
            try {
              await archiveSessionById(id);
            } catch {
              // best-effort; a failed archive leaves the session in the sidebar
            }
          }
        }
      }, []);

      // ---- digests: three-field theme cards from the host half ----
      const [digests, setDigests] = React.useState({});
      const digestRefreshRef = React.useRef({});
      React.useEffect(() => {
        let disposed = false;
        let source = null;
        const load = () => {
          fetch("/conversation-map/state", { headers: { accept: "application/json" } })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
            .then((data) => {
              if (!disposed && data && typeof data.digests === "object") {
                setDigests((prev) => {
                  const next = {};
                  for (const k of Object.keys(prev)) next[k] = prev[k];
                  for (const [k, v] of Object.entries(data.digests)) next[k] = v;
                  return next;
                });
              }
            })
            .catch(() => {});
        };
        load();
        // SSE fan-out: digest put/delete events refresh just that key.
        try {
          source = new EventSource("/conversation-map/events");
          source.addEventListener("change", (event) => {
            try {
              const change = JSON.parse(event.data);
              if (change && change.table === "digests" && typeof change.key === "string") {
                setDigests((prev) => {
                  const next = { ...prev };
                  if (change.operation === "deleted") delete next[change.key];
                  else next[change.key] = change.value;
                  return next;
                });
              }
            } catch {}
          });
        } catch {}
        const timer = setInterval(load, 60_000);
        return () => {
          disposed = true;
          clearInterval(timer);
          if (source !== null) source.close();
        };
      }, []);

      /** Force a fresh digest for one session (host route; failures surface on the card). */
      const refreshDigest = React.useCallback((node) => {
        if (node === null || node === undefined) return;
        const id = node.id;
        const mark = (pending) => {
          digestRefreshRef.current[id] = pending;
          if (pending) {
            setDigests((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), _refreshing: true } }));
          }
        };
        if (digestRefreshRef.current[id]) return;
        mark(true);
        fetch("/conversation-map/digest/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
          .then((data) => {
            if (data && data.digest) {
              setDigests((prev) => ({ ...prev, [id]: { ...data.digest, _refreshing: false } }));
            } else {
              setDigests((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), _refreshing: false } }));
            }
          })
          .catch(() => {
            setDigests((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), _refreshing: false, error: "refresh failed" } }));
          })
          .finally(() => {
            mark(false);
          });
      }, []);

      const [view, setViewState] = React.useState(mapState.view);
      const [selectedId, setSelectedIdState] = React.useState(mapState.selectedId);
      const [filter, setFilterState] = React.useState(mapState.filter);
      const [query, setQueryState] = React.useState(mapState.query);
      const setView = (updater) =>
        setViewState((v) => {
          const next = typeof updater === "function" ? updater(v) : updater;
          mapState.view = next;
          return next;
        });
      const setSelectedId = (id) => {
        mapState.selectedId = id;
        setSelectedIdState(id);
      };
      const setFilter = (f) => {
        mapState.filter = f;
        setFilterState(f);
      };
      const setQuery = (qv) => {
        mapState.query = qv;
        setQueryState(qv);
      };

      // seed the module bridge with the live chat-store actions
      React.useEffect(() => {
        bridge.actions = props && props.actions ? props.actions : null;
      }, [props]);

      const pageRef = React.useRef(null);
      const bodyRef = React.useRef(null);
      const svgRef = React.useRef(null);
      const [vpSize, setVpSize] = React.useState({ w: 0, h: 0 });
      /** Fixed-inset geometry {top,left,right} measured from the slot's parent; null until first measure. */
      const [fixed, setFixed] = React.useState(null);

      // Anchor the fixed overlay. The map page is rendered inside the host's
      // scroll container (root → header + scrollBody → viewArea → our page).
      // Measuring our own rect is only valid while we are still in-flow (first
      // paint); once we turn `position: fixed` our parent (viewArea) collapses
      // and scrolls with the body, so its rect goes stale. The scrollBody
      // container itself never moves in the flex layout, so we re-anchor from
      // IT on every resize — the map then always covers exactly the content
      // region (composer stays hidden underneath) no matter how DSH is scaled.
      React.useEffect(() => {
        // Preferred anchor: the host's scroll container (marked with
        // data-conversation-scroll). Fallbacks: nearest scrollable ancestor,
        // then the second-level parent (viewArea's parent), then the parent.
        const anchorOf = () => {
          const page = pageRef.current;
          if (page === null) return null;
          const marked = page.closest("[data-conversation-scroll]");
          if (marked !== null && marked !== page) return marked;
          let el = page;
          let depth = 0;
          while (el.parentElement !== null && depth < 4) {
            el = el.parentElement;
            depth++;
            if (depth === 1) continue; // viewArea — collapses once we're fixed
            const style = getComputedStyle(el);
            const oy = style.overflowY;
            if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
            if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) return el;
          }
          const parent = page.parentElement;
          return parent !== null && parent.parentElement !== null ? parent.parentElement : parent;
        };
        const measure = () => {
          const anchor = anchorOf();
          if (anchor === null) return;
          const r = anchor.getBoundingClientRect();
          setFixed({
            top: Math.max(0, Math.round(r.top)),
            left: Math.max(0, Math.round(r.left)),
            right: Math.max(0, Math.round(window.innerWidth - r.right)),
          });
        };
        measure();
        let ro = null;
        if (typeof ResizeObserver === "function") {
          ro = new ResizeObserver(measure);
          const anchor = anchorOf();
          if (anchor !== null) ro.observe(anchor);
        }
        window.addEventListener("resize", measure);
        return () => {
          window.removeEventListener("resize", measure);
          if (ro !== null) ro.disconnect();
        };
      }, []);

      // track the canvas body's rendered size (fires once the fixed layout lands)
      React.useEffect(() => {
        const el = bodyRef.current;
        if (el === null) return;
        const measure = () => setVpSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        let ro = null;
        if (typeof ResizeObserver === "function") {
          ro = new ResizeObserver(measure);
          ro.observe(el);
        } else {
          window.addEventListener("resize", measure);
        }
        return () => {
          if (ro !== null) ro.disconnect();
          else window.removeEventListener("resize", measure);
        };
      }, []);

      const forest = React.useMemo(() => buildForest(snap_), [snap_]);
      const model = React.useMemo(() => buildBoard(forest, layout), [forest, layout]);
      modelRef.current = model;

      /** Fit the whole board into the measured viewport. */
      const fitView = React.useCallback(() => {
        const { w, h } = vpSize;
        if (w === 0 || h === 0) return;
        const b = model.bounds;
        const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(w / b.width, h / b.height)));
        const next = { k, x: (w - b.width * k) / 2 - b.minX * k, y: (h - b.height * k) / 2 - b.minY * k };
        mapState.view = next;
        setViewState(next);
      }, [vpSize, model]);

      // fit once per page (after measurement lands) unless returning to a kept view
      React.useEffect(() => {
        if (vpSize.w > 0 && vpSize.h > 0 && !mapState.fitted) {
          mapState.fitted = true;
          fitView();
        }
      }, [vpSize, fitView]);

      // Re-fit when the canvas viewport changes size by >3% (window resize /
      // browser zoom): keeps the whole board visible and correctly scaled so
      // the map never looks broken/misaligned after resizing DSH. User-placed
      // card & frame positions are untouched — only the camera adapts. The
      // latest fitView is held in a ref so this effect only re-runs on actual
      // viewport changes, not on every model rebuild (card drags, etc).
      const lastVpRef = React.useRef({ w: 0, h: 0 });
      const fitViewRef = React.useRef(fitView);
      fitViewRef.current = fitView;
      React.useEffect(() => {
        if (vpSize.w === 0 || vpSize.h === 0) return;
        const last = lastVpRef.current;
        lastVpRef.current = vpSize;
        if (last.w === 0 || last.h === 0) return; // first measure → fit-once path
        const dw = Math.abs(vpSize.w - last.w) / last.w;
        const dh = Math.abs(vpSize.h - last.h) / last.h;
        if (dw > 0.03 || dh > 0.03) fitViewRef.current();
      }, [vpSize]);

      /** Center the viewport on one node. */
      const focusNodeId = React.useCallback(
        (id) => {
          const p = model.positions.get(id);
          const { w, h } = vpSize;
          if (p === void 0 || w === 0) return;
          const cx = p.x + NODE_W / 2;
          const cy = p.y + NODE_H / 2;
          setView((v) => ({ ...v, k: Math.max(v.k, 0.9), x: w / 2 - cx * Math.max(v.k, 0.9), y: h / 2 - cy * Math.max(v.k, 0.9) }));
        },
        [model, vpSize],
      );

      // "当前" badge needs the live selection; read it from the list snapshot
      const currentId = forest.current;

      // Count only what the map actually shows (blank placeholders and
      // removed/hidden sessions are excluded from the board).
      const visibleNodes = model.groups.flatMap((g) => g.members);
      const selected =
        selectedId !== null && model.positions.has(selectedId)
          ? (visibleNodes.find((n) => n.id === selectedId) ?? null)
          : null;
      const runningCount = visibleNodes.filter((n) => n.running).length;
      const pendingCount = visibleNodes.filter((n) => n.hasPending).length;

      const openNode = (n) => {
        void navigateToSession(sessions, n).then((ok) => {
          if (ok) backToChatView();
        });
      };

      const chip = (key, label) =>
        React.createElement(
          "button",
          { key, className: "cm-chip", "data-active": filter === key ? "1" : "0", onClick: () => setFilter(filter === key ? "all" : key) },
          label,
        );

      return React.createElement(
        "div",
        {
          ref: pageRef,
          className: "cm-page",
          style:
            fixed !== null
              ? {
                  position: "fixed",
                  top: fixed.top,
                  left: fixed.left,
                  right: fixed.right,
                  bottom: 0,
                  zIndex: 30,
                  background: COLORS.panel,
                }
              : undefined,
        },
        React.createElement(
          "div",
          { className: "cm-toolbar" },
          React.createElement("input", {
            className: "cm-search",
            placeholder: "搜索标题或 ID…（Enter 定位首个匹配）",
            value: query,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                const hit = forest.nodes.find((n) => matchesQuery(n, e.currentTarget.value));
                if (hit !== void 0) {
                  setSelectedId(hit.id);
                  focusNodeId(hit.id);
                }
              }
            },
          }),
          chip("running", `运行中 (${runningCount})`),
          chip("attention", `待交互 (${pendingCount})`),
          chip("sub", "子代理"),
          React.createElement("span", { className: "cm-count" }, `${visibleNodes.length} 个会话 · ${model.groups.length} 个工作区`),
          React.createElement("span", { className: "cm-spacer" }),
          React.createElement("button", { className: "cm-btn", onClick: fitView }, "适配视图"),
          React.createElement(
            "button",
            {
              className: "cm-btn",
              onClick: () => {
                if (currentId !== null) {
                  setSelectedId(currentId);
                  focusNodeId(currentId);
                }
              },
            },
            "定位当前",
          ),
        ),
        React.createElement(
          "div",
          { ref: bodyRef, className: "cm-body" },
          visibleNodes.length === 0
            ? React.createElement("div", { className: "cm-hint" }, "当前还没有任何会话。", React.createElement("br", null), "开始一段对话后，地图会实时长出来。")
            : React.createElement(MapCanvas, {
                model,
                view,
                setView,
                svgRef,
                selectedId,
                onSelectNode: setSelectedId,
                onOpenNode: openNode,
                onRefreshDigest: refreshDigest,
                filter,
                query,
                currentId,
                digests,
                onMoveCard,
                onMoveFrame,
                onResizeFrame,
                onSwapCards,
                onRemoveCard,
                onRemoveGroup,
              }),
          React.createElement(DetailCard, {
            node: selected,
            digest: selected !== null ? digests[selected.id] : undefined,
            onClose: () => setSelectedId(null),
            onRefreshDigest: refreshDigest,
          }),
          React.createElement(
            "div",
            { className: "cm-legend" },
            React.createElement("span", null, React.createElement("i", { className: "cm-dot cm-running-dot", style: { background: COLORS.green } }), "运行中"),
            React.createElement("span", null, React.createElement("i", { className: "cm-dot", style: { background: COLORS.amber } }), "待交互"),
            React.createElement("span", null, "拖动卡片 = 摆放（吸附，占位自动交换）· 拖动工作区 = 移动（碰撞被挡住）· 鼠标移到框边缘 = 拉大拉小 · 双击 = 打开"),
          ),
        ),
      );
    }
    //#endregion

    //#region sidebar footer button (stacked, activates the 地图 tab)
    function FooterButton({ wide }) {
      const [hint, setHint] = React.useState(false);
      const hintTimer = React.useRef(null);
      React.useEffect(
        () => () => {
          if (hintTimer.current !== null) clearTimeout(hintTimer.current);
        },
        [],
      );
      const activate = () => {
        if (bridge.actions !== null && typeof bridge.actions.setView === "function") {
          bridge.actions.setView(VIEW_ID);
        } else {
          setHint(true);
          if (hintTimer.current !== null) clearTimeout(hintTimer.current);
          hintTimer.current = setTimeout(() => setHint(false), 2600);
        }
      };
      return React.createElement(
        "div",
        {
          className: "cm-foot-wrap",
          style: wide ? { width: "100%", flex: "1 1 100%", minWidth: 0 } : { flex: "0 0 auto" },
        },
        React.createElement(
          "button",
          {
            className: "cm-foot-btn",
            title: "对话地图",
            "aria-label": "对话地图",
            onClick: activate,
            style: wide
              ? { width: "100%", height: 34, padding: "0 12px", justifyContent: "flex-start", fontSize: 12.5 }
              : { width: 36, height: 36 },
          },
          React.createElement(BranchIcon, { size: 17, color: "currentColor" }),
          wide ? React.createElement("span", null, "对话地图") : null,
        ),
        hint
          ? React.createElement("div", { className: "cm-foot-hint" }, "首次请点顶部「地图」页签，之后这里就能直接打开")
          : null,
      );
    }
    //#endregion

    //#region exports — the client plugin face
    exports.name = PLUGIN_ID;
    exports.inject = ["slots", "sessions", "workspaces"];

    exports.apply = function apply(ctx) {
      ensureStyle();

      const sessionsApi = ctx.sessions;
      if (sessionsApi === void 0 || sessionsApi.list === void 0) {
        // Declared hard, so absence means the host composition changed;
        // stay inert rather than half-work.
        return;
      }
      // Bind the module-level session service used by MapView/DetailCard.
      sessions = sessionsApi;
      // Workspace service (archiveSession for the delete path). Absence only
      // disables the destructive menu entries; the map itself keeps working.
      workspaces = ctx.workspaces;

      const slots = ctx.slots;
      if (slots === undefined) return;

      // 地图 tab in the conversation view ring (beside 对话 / 轨迹).
      slots.inject("conversation.view", () =>
        slots.register({ name: "conversation.view", id: VIEW_ID, order: 30, label: () => "地图" }, MapView),
      );

      // Sidebar foot entry, stacked on its own row below other plugin cards.
      slots.inject("sidebar.footer.action", () =>
        slots.register({ name: "sidebar.footer.action", id: "conversation-map", order: -20, label: () => "对话地图" }, FooterButton),
      );
    };

    return module.exports;
  },
});
