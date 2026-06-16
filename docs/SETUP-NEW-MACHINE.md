# Setup on a new Mac

The functional-cert harness has three moving parts that each need wiring once per machine.
Everything is portable as long as the MCP lives at `~/.mcp-servers/wp-plugin-qa-mcp-server`.

## 1. Clone + build the MCP server

```bash
mkdir -p ~/.mcp-servers
git clone https://github.com/vapvarun/wp-plugin-qa-mcp-server.git ~/.mcp-servers/wp-plugin-qa-mcp-server
cd ~/.mcp-servers/wp-plugin-qa-mcp-server
npm ci
npm run build          # produces build/ (tracked, but rebuild to be safe)
```

## 2. Register the MCP server with Claude

Add to `~/.claude.json` under `mcpServers` (if not already present — it syncs via the dotfiles repo on most machines):

```json
"wp-plugin-qa": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/<you>/.mcp-servers/wp-plugin-qa-mcp-server/build/index.js"],
  "env": {}
}
```

Restart the Claude session. The tools `wppqa_audit` (generic functional audit) and `wppqa_certify`
(per-plugin `cert` delegate) become available. **MCP tools only load at session start — after any
rebuild or registration change, restart the session.**

## 3. Register the Stop-hook gate (real-time self-correction)

Add to `~/.claude/settings.json` under `hooks` (merge — do not overwrite existing hooks):

```json
"Stop": [
  { "hooks": [ { "type": "command",
    "command": "node \"$HOME/.mcp-servers/wp-plugin-qa-mcp-server/hooks/cert-stop.mjs\"" } ] }
]
```

This is a **safe global no-op**: it exits immediately in any repo without a `.cert.json`, so it only
does work in plugins you've configured (step 4). It runs the functional engine on the surfaces you
touched this session and blocks finishing on any failure you introduced. Both `~/.claude/settings.json`
and the `settings.json` mirrored in the dotfiles/`claude-backup` repo carry this entry, so it syncs.

## 4. Per-plugin config (`.cert.json`)

In each plugin repo you want the gate + audit on, drop a gitignored `.cert.json`:

```json
{
  "wp_path": "/Users/<you>/Local Sites/<site>/app/public",
  "plugin_path": "/Users/<you>/dev/repos/<plugin>",
  "oracles_path": "/Users/<you>/dev/repos/<plugin>/audit/cert-oracles.json"
}
```

`plugin_path` defaults to the repo; `oracles_path` defaults to `<plugin>/audit/cert-oracles.json`.
Without a `wp_path` (config or `BN_WP_PATH` env), the harness is inert for that repo.

## 5. Generate the manifest + write oracles (per plugin)

```bash
node ~/.mcp-servers/wp-plugin-qa-mcp-server/bin/write-manifest.mjs /Users/<you>/dev/repos/<plugin>
# → deterministic audit/manifest.json (v3 functional layers + legacy keys). Commit it.
```

Then author `<plugin>/audit/cert-oracles.json` (one row per gated setting). See
[USING-ON-OTHER-PLUGINS.md](USING-ON-OTHER-PLUGINS.md) §3 for the oracle format and how to find
candidates (`grep "_disabled'"`).

## Verify the whole chain

```bash
# Generic audit on any configured plugin:
node --input-type=module -e '
import { runEngine, formatEngine } from "/Users/<you>/.mcp-servers/wp-plugin-qa-mcp-server/build/cert-runner.js";
console.log(formatEngine(runEngine({
  wpRoot: "/Users/<you>/Local Sites/<site>/app/public",
  pluginPath: "/Users/<you>/dev/repos/<plugin>",
  oraclesPath: "/Users/<you>/dev/repos/<plugin>/audit/cert-oracles.json"
})));'
```
Expected: `N passed · 0 failed · M candidates`. Then, in a Claude session, make an edit that breaks a
toggle → the Stop hook blocks the turn with the correction.

## How it all connects

- **Onboard** (`/wp-plugin-onboard` Phase 2.0) calls `bin/write-manifest.mjs` — one deterministic
  generator, no agent prose.
- **wp-contract-audit / action-audit** find static candidates; `wppqa_audit` (this MCP) confirms them
  at runtime — detective → jury.
- **wp-plugin-release-qa** wires `wppqa_audit` as a release gate (0 failures required).
- **Stop hook** runs the same engine on your own edits, in-session, before anything reaches QA.

One engine, four entry points (onboard, audit skills, release gate, real-time hook).
