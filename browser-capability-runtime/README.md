# Browser Capability Runtime

A business-neutral reference implementation that lets multiple browser tools
operate against one externally managed Chrome/Chromium session.

The runtime owns browser lifecycle and exposes a shared CDP endpoint. Thin
adapters attach Midscene and `playwright-cli` to that endpoint instead of
allowing each tool to create or close its own browser.

## Capabilities

- Start, reuse, restart, and stop a tracked Chrome/Chromium process.
- Allocate an isolated profile and a loopback CDP port.
- Select a page by configurable URL pattern.
- Run focused `Runtime.evaluate` diagnostics.
- Capture network and console events with privacy-preserving defaults.
- Serialize actions from different browser tools with one operation lock.
- Attach Midscene and Playwright CLI to the same browser context.

This is an integration pattern and reference implementation, not a browser
automation framework.

## Requirements

- Bash
- Node.js 22 or newer
- `curl` and `flock`
- Chrome or Chromium
- Optional: Midscene CLI and `playwright-cli`

## Browser Runtime

```bash
npm exec -- browser-runtime restart demo
npm exec -- browser-runtime endpoint
npm exec -- browser-runtime page-info
npm exec -- browser-runtime eval 'document.title'
npm exec -- browser-runtime trace start
npm exec -- browser-runtime trace dump
npm exec -- browser-runtime trace stop
npm exec -- browser-runtime stop
```

Useful configuration:

| Variable | Default | Meaning |
|---|---|---|
| `BROWSER_RUNTIME_STATE_DIR` | XDG user state | Private runtime directory |
| `BROWSER_RUNTIME_CHROME` | auto-detected | Chrome/Chromium executable |
| `BROWSER_RUNTIME_PORT` | `9222` | Preferred loopback CDP port |
| `BROWSER_RUNTIME_HEADLESS` | `true` | Start in headless mode |
| `BROWSER_RUNTIME_PAGE_URL_PATTERN` | unset | JavaScript regular expression for page selection |
| `BROWSER_RUNTIME_WINDOW_SIZE` | `1920,1080` | Browser window size |
| `BROWSER_RUNTIME_EXTRA_ARGS` | unset | Additional browser flags, split by shell whitespace |
| `BROWSER_RUNTIME_EVAL_SIDE_EFFECTS` | `false` | Allow diagnostic evals that may have side effects |

If no page URL pattern is configured, the most recently listed page target is
selected.

## Midscene Adapter

The adapter expects a command compatible with the Midscene web CLI. Configure
an exact package version for reproducible use:

```bash
export BROWSER_MIDSCENE_PACKAGE='@midscene/web@<exact-version>'
npm exec -- browser-midscene tap --locate '{"prompt":"the submit button"}'
```

The wrapper injects `MIDSCENE_CDP_ENDPOINT` and the `--cdp` mode flag. Callers
cannot override the endpoint or close the shared browser.

For non-standard CLI names, set `BROWSER_MIDSCENE_COMMAND`. Test harnesses or
local integration layers can set `BROWSER_MIDSCENE_RUNNER` to bypass npm while
preserving the same injected environment and arguments.

## Playwright Adapter

```bash
npm exec -- browser-playwright snapshot
npm exec -- browser-playwright click <target>
npm exec -- browser-playwright status
npm exec -- browser-playwright detach
```

The wrapper creates a deterministic attached session and blocks lifecycle and
connection flags owned by the shared runtime.

Use `BROWSER_PLAYWRIGHT_SESSION` to change the deterministic session name.
Set `BROWSER_PLAYWRIGHT_PACKAGE` to an exact npm package spec when the adapter
should invoke a package through `npm exec`; otherwise it calls the local
`playwright` command.

## Trace Privacy

Trace capture is intentionally conservative:

- URL query strings are removed by default.
- Request and response headers are omitted by default.
- Request and response bodies are omitted by default.
- Sensitive headers remain redacted even when header capture is enabled.

Explicit diagnostic overrides:

```bash
export BROWSER_TRACE_INCLUDE_QUERY=true
export BROWSER_TRACE_CAPTURE_HEADERS=true
export BROWSER_TRACE_CAPTURE_BODIES=true
```

Trace output can still contain sensitive application data. Keep the runtime
directory private and do not publish its contents.

## Verify

The tests use fake browser and CLI processes; they do not require Chrome,
Midscene, or Playwright to be installed.

```bash
npm run verify
```
