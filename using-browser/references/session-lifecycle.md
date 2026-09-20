# Session Lifecycle & State

## State directory

The runtime keeps all state under a private user-level directory (mode 0700),
resolved in this order:

1. `BROWSER_RUNTIME_STATE_DIR` — explicit override.
2. `$XDG_STATE_HOME/browser-capability-runtime`
3. `~/.local/state/browser-capability-runtime`
4. `$PWD/.browser-state` (fallback when nothing else is set)

Files inside it:

| File | Purpose |
|---|---|
| `browser.pid` | Tracked Chrome pid; the literal `external` while attached to an externally managed browser |
| `endpoint` | Recorded CDP endpoint: local `http://127.0.0.1:<port>` or the connected external URL |
| `runtime.json` | Snapshot: pid, endpoint, profileDir, startedAt — or `{"pid":"external","external":true,...,"connectedAt"}` in external mode |
| `profile/` | Isolated Chrome user-data-dir (cookies persist here) |
| `operation.lock` | Non-blocking `flock` serializing wrapper actions |
| `trace.jsonl` / `trace.pid` / `trace.log` | Trace output, listener pid, listener log |
| `playwright-session.json` | Attached-session descriptor |
| `browser.log` | Chrome stderr |

Keep this directory private. It can contain cookies and (if you enable capture)
sensitive request/response data.

## Operation lock

Every wrapper action and lifecycle command takes one non-blocking `flock` on
`operation.lock`. If another operation is active, the command exits `75` with
"browser runtime is busy; another operation is active". **Do not bypass it.**
Surface the lock failure and retry once the active command finishes. Internal
helpers (e.g. the adapter resolving the endpoint) set
`BROWSER_RUNTIME_LOCK_BYPASS=true` to read state without contending the lock.

## start vs reuse vs restart

| Command | Behavior |
|---|---|
| `start` / `reuse [url]` | If the tracked browser process is live and has a recorded endpoint, reuse it. Otherwise launch a new Chrome. In external mode, reuses the external endpoint while it is reachable. |
| `restart [url]` | Stop the tracked browser process, clear trace state, then start fresh. **Use this to begin a new task.** Exits external mode: forgets the external browser and starts a local one. |
| `connect <cdp-url>` | Attach to an externally managed CDP browser: normalize + probe the URL, detach the Playwright session, stop a locally managed browser, then record the `external` marker. Never spawns a browser. |
| `stop` | Stop trace, terminate the tracked browser process with SIGTERM/SIGKILL fallback, and remove runtime state. In external mode it only **forgets** the external browser — it never kills a process the runtime does not own. |

External-mode liveness is a `/json/version` probe of the recorded endpoint;
to continue a later task on the same external browser, re-run
`connect <same-url>` (the generic `restart` initializer would switch back to
a local browser).

Reuse within a task; restart only between tasks.

## Profile and authentication

`restart` preserves the `profile/` directory and its cookies by default, so
authentication survives across tasks that share the same runtime dir. Clear the
profile only when the user asks for a clean-auth run or stale auth is the
problem.

## Singleton across tasks

The runtime is a user-level singleton: one Chrome process per state directory at
a time. Parallel browser tasks are not supported. A new task's `restart`
intentionally replaces the previous browser — that is expected, not data loss,
because the profile is retained.
