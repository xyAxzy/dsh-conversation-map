# dsh-conversation-map

A live conversation map for DeepSeek Harness web: every session in the workspace as a real-time tree — subagent lineage, running state, and one-click navigation.

> **v0.2.0** — tree auto-layout, workspace theme colors, grid-paper canvas

![preview](assets/preview-v2.png)

## Features

- **Tree auto-layout**: sessions are arranged by parent/child relation — parents on the left column, forked sub-sessions indented one column to the right, siblings stacked vertically. The lineage is obvious at a glance.
- **Edge avoidance**: connectors sample the real bezier curve; cards crossed by a line are automatically moved to the nearest free slot inside their workspace frame.
- **Workspace theme colors**: frame borders, session card borders (selected vs idle depth), and parent-child connectors all inherit the workspace's theme color.
- **Grid-paper canvas**: the background is a zoom/pan-following grid; workspaces are transparent hand-drawn-style boxes (no shadow).
- **Auto-growth**: when a new/forked session arrives, the workspace frame grows to fit — cards never overlap and never overflow the frame.
- **Live status**: running / pending / idle dots.
- **One-click navigation**: double-click a card to jump to that session.
- **Zoomable canvas**: pan / zoom / drag workspace frames, positions persisted to localStorage.

## Install

```bash
dsh plugins add dsh-conversation-map
```

Then restart `dsh web`. A "对话地图" (Conversation Map) entry appears at the bottom of the left sidebar.

## Usage

- Click "对话地图" in the bottom-left to open the map tab
- **Double-click** a session card to jump to that session
- **Forking**: ask the agent to spawn a subagent, or hover a message and click the branch icon — the map auto-draws the parent-child edge and tree branch
- Drag a workspace's header bar to move it; drag its corner to resize
- Click a card to view its summary / key findings / next step

## Changelog

### v0.2.0

- Tree auto-layout (groupTree hierarchy): parents left, children indented right, same-depth stacked, auto-avoid overlap
- Edge avoidance: bezier sampling + nearest free slot evacuation inside the frame (with frame auto-growth)
- Workspace theme color threading: borders/cards/edges inherit, selected-state depth distinction
- Card text truncated by visual width (CJK never overflows)
- Removed session-count badge, card refresh button, selected "current" badge
- Frame border color stays consistent while dragging
- Grid-paper background + transparent sketchy workspace boxes

### v0.1.0

- First release: workspace-grouped real-time session tree
- Subagent lineage edges, running-state dots, double-click navigation
- Resizable / draggable workspace frames with persisted positions

## License

MIT
