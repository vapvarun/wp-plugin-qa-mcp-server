# Functional self-correction Stop hook

`cert-stop.mjs` is a Claude Code **Stop hook**: after the agent finishes a turn, it runs the generic
functional engine on the plugin the agent touched and **blocks finishing** if the agent introduced a
confirmed behavioural failure (dead toggle, route fatal). It is the real-time wiring that makes the
whole harness not-waste — cert as the agent's enforced definition of done.

## One-time setup

1. **Per-repo config** — drop `.cert.json` in the plugin repo root (gitignored; machine-specific):

   ```json
   {
     "wp_path": "/abs/path/to/WordPress/root",
     "plugin_path": "/abs/path/to/plugin/repo",
     "oracles_path": "/abs/path/to/plugin/audit/cert-oracles.json"
   }
   ```
   `plugin_path` defaults to the repo; `oracles_path` defaults to `<plugin>/audit/cert-oracles.json`.
   Without a `wp_path` (config or `BN_WP_PATH` env) the hook is a silent no-op.

2. **Register the hook** in `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "Stop": [
         { "hooks": [ { "type": "command",
           "command": "node ~/.mcp-servers/wp-plugin-qa-mcp-server/hooks/cert-stop.mjs" } ] }
       ]
     }
   }
   ```

## Behaviour

- **No plugin code changed this turn** (`git diff` has no `.php`/`.js`) → exits in <50ms, no engine run.
- **First Stop of the session** → captures a baseline of current failures (pre-existing debt isn't
  yours), does not block.
- **Subsequent Stops** → runs the engine; blocks only on failures **not** in the baseline (the ones
  the agent introduced), feeding the `file/entity + verdict` back as the correction.
- **Engine can't run** (no wp, plugin inactive) → fails safe: does not block.

## Test it

```bash
echo '{"cwd":"/path/to/plugin","session_id":"t1"}' | node hooks/cert-stop.mjs   # 1st run: baseline
echo '{"cwd":"/path/to/plugin","session_id":"t1"}' | node hooks/cert-stop.mjs   # 2nd run: blocks on new fails
```
