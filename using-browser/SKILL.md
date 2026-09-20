---
name: using-browser
description: Drive any web page through a shared, externally managed Chrome/CDP session. Navigate, inspect page title/URL/tabs/cookies, run JavaScript in a live page, capture network and console traces, and perform deterministic UI interaction (click, type, hover, snapshot) via an attached Playwright session — with optional visual/semantic target recognition through Midscene when a target cannot be found deterministically. Business-neutral; no product knowledge or knowledge base is bundled. Use whenever the user wants to control or inspect a browser, automate or verify a web UI, capture console/network traffic, run JS in a real page, or locate a UI element by visual/semantic description.
allowed-tools: Bash(scripts/browser-runtime:*), Bash(scripts/browser-playwright:*), Bash(scripts/browser-midscene:*), Bash(scripts/browser-midscene-ready:*), Bash(node:*), Bash(curl:*), Read
metadata:
  author: keynez
---

## Overview

This skill drives a **shared Chrome/CDP session** to operate on arbitrary web
pages: navigation, read-only diagnostics (title, URL, tabs, cookies, network and
console trace), focused JavaScript evaluation, and deterministic UI interaction
through an attached Playwright session — with optional visual/semantic target
recognition through Midscene.

It is **business-neutral**. It bundles no product knowledge, no credentials, no
site-specific selectors, and no knowledge base. It owns the browser lifecycle so
that Playwright and Midscene attach to one managed session instead of each
launching its own browser.

This skill is **self-contained and canonical**: the Chrome/CDP engine lives in
`scripts/` alongside the Playwright and Midscene adapters. The engine originated
as `browser-capability-runtime`; `test/` holds fake-based contract tests, and
real-browser smoke is the source of truth.

## When to Use This Skill

Use this skill when the user wants to:

- Open a URL, navigate, or drive a real browser page
- Inspect page state: title, URL, open tabs, cookies
- Run JavaScript in a live page and read the result
- Capture network requests/responses and console output for diagnosis
- Perform deterministic UI automation: click, type, hover, keyboard, snapshot
- Identify a visual/semantic target that cannot be found deterministically
  (optional, via Midscene)
- Verify a page is meaningfully loaded (not just the app shell)
- Debug a UI issue that needs a live browser (redirects, session modals, hover
  controls, console errors)

Browser interaction is **Playwright-first**. Use `scripts/browser-playwright`
for ordinary deterministic UI work when a target can be identified from a fresh
snapshot by role, visible text, selector, or stable reference. Treat Midscene as
an optional visual/semantic capability: probe it only when the target cannot be
identified deterministically, or when the user explicitly requests Midscene. Both
engines use the same external Chrome/CDP session owned by
`scripts/browser-runtime`.

## Browser Session Lifecycle

At the start of every **new task that will use a browser**, discard browser
process/session state left by a previous task before inspecting or navigating
the UI. Do this even when the existing page appears usable or authenticated.

1. Detach the configured Playwright wrapper session if it exists, then restart
   the shared browser before screenshots, diagnostics, or navigation:

   ```bash
   scripts/browser-playwright detach || true
   scripts/browser-runtime restart <url>
   ```

   Do not use `start` as the new-task initializer because `start` intentionally
   reuses a live endpoint. `restart` stops the browser process tracked in this
   runtime's user-level state/profile directory; do not replace it with a
   machine-wide browser kill.
2. Use `scripts/browser-playwright` as the default interaction engine. It
   attaches the configured named session to the current shared endpoint
   automatically. Do not call `playwright open`, `playwright attach`, or browser
   close/kill commands.
3. If a step requires visual/semantic target recognition that Playwright cannot
   provide, or the user explicitly requests Midscene, run
   `scripts/browser-midscene-ready` once at that first point of need. Cache its
   result for the rest of the task; do not repeat the probe before every action.
   A successful static probe confirms local configuration and prerequisites, not
   model-service availability. The first real Midscene action is the service
   check. Midscene is inert unless its model env vars are set, so on a host
   without them the probe simply reports Midscene unavailable and you continue
   with Playwright.
4. Before that first Midscene action, read `references/midscene-adapter.md`
   completely, then use only `scripts/browser-midscene`. The wrapper dynamically
   resolves the current endpoint, sets `MIDSCENE_CDP_ENDPOINT`, and adds the bare
   `--cdp` mode flag. The environment variable supplies the value only; without
   the flag, upstream Midscene would silently use its own Puppeteer browser.
5. If the Midscene probe fails, or the first real action exposes a model-service
   or configuration failure, mark Midscene unavailable for the rest of the task
   and continue with Playwright by default. Do not treat an ordinary locate or
   UI-action failure as an availability failure; use the Midscene failure flow.
   Stop and surface the limitation only when the required visual capability has
   no deterministic alternative or the user explicitly required Midscene.
6. Reuse the newly created browser/session for every action in the current task.
   Do not restart between steps, turns, or retries within the same task.

Midscene and Playwright share page state but not captured target identity. After
every engine switch, capture a fresh Playwright snapshot before continuing and
discard prior snapshot refs, locate results, and coordinates. If the next action
uses Midscene, obtain a fresh locate from the current state; after any Midscene
action, refresh the Playwright snapshot before the next action.

A follow-up that clearly continues the same unfinished browser workflow is not a
new task. Reuse browser state from an earlier task only when the user explicitly
asks to continue or resume that state.

Fresh task initialization resets the browser process, tabs, runtime metadata, and
captured trace. It preserves the configured browser profile and its cookies by
default so authentication can survive. Clear session/profile data only when the
user requests a clean-auth run or stale authentication is the problem.

The browser runtime is a user-level singleton shared by all `using-browser`
invocations. Parallel browser tasks are not supported. Wrapper actions and
browser lifecycle commands use one non-blocking operation lock; if another
operation is active, stop and surface the lock failure instead of bypassing it.
When the lock is available, a new task's `restart` intentionally replaces the
previous singleton browser. If the lock is busy, retry only after the active
command has finished.

### Attaching to an externally managed browser (CDP URL)

When the user supplies a CDP URL for a browser this runtime does not own, use
`connect` instead of starting a local one:

```bash
scripts/browser-runtime connect http://127.0.0.1:9333
```

Use `connect` only when the user provides an external CDP endpoint; otherwise
the default `start`/`restart` lifecycle applies. Its contract:

- `connect` never spawns a browser and never touches the local profile. The
  URL is normalized (a missing `http(s)://` scheme is added; trailing `/`,
  `/json`, `/json/list`, `/json/version` are stripped) and probed once before
  any state changes — an unreachable URL fails without touching the current
  runtime.
- Switching stops a locally managed browser first; it would otherwise keep
  running untracked, holding the profile lock and the CDP port.
- `stop` only **forgets** an external browser — it never kills a process the
  runtime does not own. `restart` afterwards starts a locally managed browser
  again (`start` still reuses the external endpoint while it is reachable).
- All diagnostics (`endpoint`, `page-info`, `eval`, `trace`) and the Playwright
  adapter work unchanged against the external endpoint.
- Liveness of an external browser is a `/json/version` probe, so operations
  that need a live browser make one extra HTTP request to it.
- A new task that should continue on the same external browser re-runs
  `connect` with the same URL; the generic `restart` initializer would switch
  back to a local browser.

## Browser Operation Boundary

Choose the mechanism by capability; this is not a linear escalation ladder:

1. **Deterministic UI operation — Playwright by default.** Use a fresh
   Playwright snapshot and ordinary role/text/selector/reference-based actions
   for click, input, hover, keyboard, scrolling, and verification.
2. **Visual/semantic target recognition — Midscene on demand.** Use one Midscene
   terminal action when the visible target cannot be identified deterministically,
   or when the user explicitly asks for Midscene. Do not use Midscene merely
   because an ordinary Playwright action failed; first refresh the snapshot and
   diagnose the failure.
3. **Coordinate input — Playwright mouse commands.** When a visible target has
   fresh coordinates from the current snapshot or read-only geometry, use
   `browser-playwright mousemove`, `mousedown`, `mouseup`, or `mousewheel` as
   appropriate. Keep the coordinate interaction minimal, then capture a fresh
   snapshot and verify. Do not describe this as CDP input or dispatch it through
   `browser-runtime eval`.
4. **Diagnostics — read-only CDP.** Prefer `browser-runtime` for URL, title, tab
   selection, network trace, console/page errors, cookies, request status, and
   minimal read-only visible geometry. Do not dump the full DOM or use app
   internals as the primary way to understand UI state.
5. **Known event compatibility trap — controlled eval only.** Use
   `scripts/browser-runtime eval` only when the target is already identified from
   the current UI and a documented trap requires a specific DOM event sequence
   that native Playwright pointer input cannot reliably produce (for example,
   `pointerdown → mousedown → pointerup → mouseup → click`). Keep the eval to the
   smallest event-only operation; do not mutate framework/internal state, call
   product APIs, touch network/storage/auth data, or use it to discover the UI.
   Verify the visible result immediately afterward. A bare
   `querySelector().click()` remains disallowed when the documented event
   sequence is required. Do not attach another CDP client to bypass the managed
   browser/session.

## Setup

The runtime auto-detects Chrome/Chromium. No manual configuration is required for
core lifecycle, diagnostics, and eval.

Do not run Midscene readiness during routine setup. At the first step that
actually needs Midscene, run `scripts/browser-midscene-ready` once and cache the
result for the task.

The engine wrappers are self-describing and proxy the installed upstream CLI help
without requiring a live browser. Use them whenever a command or parameter is
uncertain:

```bash
scripts/browser-midscene --help
scripts/browser-midscene help tap
scripts/browser-playwright --help
scripts/browser-playwright help snapshot
scripts/browser-runtime eval --help
```

Do not invoke `npx @midscene/web` or `playwright-cli` directly. The wrappers keep
upstream parameters available while enforcing the shared CDP connection.

### Useful environment

| Variable | Default | Meaning |
|---|---|---|
| `BROWSER_RUNTIME_CHROME` | auto-detected | Chrome/Chromium executable |
| `BROWSER_RUNTIME_PORT` | `9222` | Preferred loopback CDP port |
| `BROWSER_RUNTIME_CONNECT_TIMEOUT` | `5` | Seconds for the connect probe and external liveness checks |
| `BROWSER_RUNTIME_HEADLESS` | `true` | Start headless |
| `BROWSER_RUNTIME_PAGE_URL_PATTERN` | unset | JS regex for page selection |
| `BROWSER_RUNTIME_WINDOW_SIZE` | `1920,1080` | Browser window size |
| `BROWSER_RUNTIME_EVAL_SIDE_EFFECTS` | `false` | Allow evals with side effects |
| `BROWSER_PLAYWRIGHT_SESSION` | `shared-browser` | Deterministic session name |
| `BROWSER_PLAYWRIGHT_COMMAND` | `playwright-cli` | CLI command of `@playwright/cli` |
| `BROWSER_PLAYWRIGHT_PACKAGE` | unset | Exact `@playwright/cli` npm spec to invoke via `npm exec` |
| `BROWSER_MIDSCENE_PACKAGE` | unset | Exact Midscene npm spec (required to use Midscene) |
| `BROWSER_MIDSCENE_COMMAND` | `midscene` | Midscene CLI command inside the package |
| `MIDSCENE_MODEL_*` | unset | Model service env (API_KEY/NAME/BASE_URL/FAMILY); unset ⇒ Midscene unavailable |

Per-user defaults live in `references/preferences.md`; edit it locally.

## Privacy

Trace capture is conservative by default: URL query strings are stripped, request
and response headers are omitted, bodies are omitted, and sensitive headers
(auth, cookies, tokens) are redacted even when header capture is on. Enable
`BROWSER_TRACE_CAPTURE_HEADERS`, `BROWSER_TRACE_CAPTURE_BODIES`, or
`BROWSER_TRACE_INCLUDE_QUERY` only when the task explicitly needs them, and keep
the runtime state directory private. Trace output can still contain sensitive
application data; do not publish it. See `references/privacy.md`.

## Bundled Interfaces

- `scripts/browser-runtime` — Chrome lifecycle (`start`/`reuse`/`restart`/`stop`),
  `connect` to an externally managed CDP browser, `status`, `endpoint`,
  `page-info`, `eval`, and `trace start|stop|dump|clear`.
- `scripts/browser-playwright` — default deterministic interaction engine
  (`snapshot`, `click`, `fill`, …) plus `status`/`attach`/`detach` on the shared
  session.
- `scripts/browser-midscene-ready` — probes the optional Midscene capability on
  demand; it is not the new-task initializer or a global engine selector.
- `scripts/browser-midscene` — optional visual/semantic terminal actions on the
  shared session after the lazy readiness probe succeeds.
- `scripts/cdp.mjs`, `cdp-eval.mjs`, `cdp-trace.mjs`, `select-page.mjs` —
  internal CDP helpers used by `browser-runtime`; not invoked directly.
