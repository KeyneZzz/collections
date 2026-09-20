# Command Cheatsheet

Intent → exact command. Run every command through the bundled wrappers under
`scripts/`. All paths are relative to the skill directory.

## Lifecycle

| Intent | Command |
|---|---|
| Start a new task's browser (stops tracked browser first) | `scripts/browser-runtime restart <url>` |
| Reuse a live endpoint if present, else start | `scripts/browser-runtime start <url>` |
| Attach to an externally managed browser (user-supplied CDP URL) | `scripts/browser-runtime connect <cdp-url>` |
| Continue a task on the same external browser | `scripts/browser-runtime connect <same-url>` (not `restart`, which switches back to local) |
| Stop the shared browser + clear runtime state | `scripts/browser-runtime stop` |
| Is the browser up? pid, endpoint, trace status | `scripts/browser-runtime status` |
| Print the browser-level CDP websocket endpoint | `scripts/browser-runtime endpoint` |

`restart` is the new-task initializer, never `start`. `connect` never spawns
a browser and `stop` only forgets an external one — it never kills a process
the runtime does not own.

## Diagnostics (read-only CDP)

| Intent | Command |
|---|---|
| Selected page id/title/url + page counts | `scripts/browser-runtime page-info` |
| Run JS in the selected page, await promise, return by value | `scripts/browser-runtime eval '<expr>'` |
| Eval a multiline expression from stdin | `scripts/browser-runtime eval -` |
| Eval a file | `scripts/browser-runtime eval --file <path>` |

Page selection: if `BROWSER_RUNTIME_PAGE_URL_PATTERN` is set, the page whose URL
matches the regex is selected; otherwise the most recently listed page target.

## Trace (network + console)

| Intent | Command |
|---|---|
| Start a long-lived network/console trace | `scripts/browser-runtime trace start` |
| Stop the trace listener | `scripts/browser-runtime trace stop` |
| Dump captured records (raw JSONL) | `scripts/browser-runtime trace dump` |
| Clear captured records | `scripts/browser-runtime trace clear` |

Privacy defaults apply (see `privacy.md`).

## Playwright (deterministic UI)

| Intent | Command |
|---|---|
| Readiness: is Playwright installed? | `command -v playwright-cli` |
| Fresh accessibility/DOM snapshot | `scripts/browser-playwright snapshot` |
| Click / fill / hover / keyboard | `scripts/browser-playwright <playwright-args…>` |
| Show current session state | `scripts/browser-playwright status` |
| Force attach the named session | `scripts/browser-playwright attach` |
| Detach the session | `scripts/browser-playwright detach` |
| Proxy upstream help | `scripts/browser-playwright --help` |

The wrapper runs every action against the named session (`--session`) on the
shared CDP endpoint, auto-attaching when the session is not open. Blocked
upstream flags: `--cdp`, `--cdp-endpoint`, `--endpoint`, `--session`, `-s`,
`--browser`, `--browser-channel`, `--user-data-dir`, `--port`, and lifecycle
verbs (`open`/`close`/`close-all`/`kill-all`/`quit`/`kill`/`stop`/`restart`/`launch`).

## Midscene (optional, on demand)

Inert unless `MIDSCENE_MODEL_*` env vars are set. Run the readiness probe once at
the first point of need, then cache the result for the task.

| Intent | Command |
|---|---|
| Probe Midscene readiness (static; no model call) | `scripts/browser-midscene-ready` |
| Probe + shared Chrome/CDP smoke | `scripts/browser-midscene-ready --smoke` |
| Click a visible element | `scripts/browser-midscene tap --locate '{"prompt":"..."}'` |
| Type final text into a field | `scripts/browser-midscene input --value "..." --locate '{"prompt":"..."}'` |
| Hover (e.g. to reveal a control) | `scripts/browser-midscene hover --locate '{"prompt":"..."}'` |
| Press a key | `scripts/browser-midscene keyboardpress --keyName Enter` |
| Screenshot for state review | `scripts/browser-midscene take_screenshot` |
| Proxy upstream help | `scripts/browser-midscene --help` |

Forbidden: `act`, `--deep-think`, `--deep-locate`, and any caller-supplied
`--cdp`/`--bridge`. The wrapper owns the CDP connection and lifecycle. See
`midscene-adapter.md` for the full terminal-action contract.

## Escaping from a stuck session

If Playwright reports a stale session or the browser is wedged:

```bash
scripts/browser-playwright detach || true
scripts/browser-runtime restart <url>
```
