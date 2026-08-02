# Playwright Adapter

`scripts/browser-playwright` is the default deterministic interaction engine. It
attaches Playwright to the shared Chrome/CDP session owned by
`browser-runtime`, instead of letting Playwright launch its own browser.

## How it attaches

On every action it:

1. Resolves the current endpoint from `browser-runtime endpoint` (lock bypassed,
   since the shared runtime is already running).
2. Writes a deterministic session descriptor to the runtime state dir
   (`playwright-session.json`) recording `attached`, `session`, `endpoint`, and
   `attachedAt`.
3. Exports `BROWSER_PLAYWRIGHT_CDP_ENDPOINT`, `PLAYWRIGHT_CDP_ENDPOINT`, and
   `BROWSER_PLAYWRIGHT_SESSION_NAME` for the upstream CLI.
4. Appends `--cdp-endpoint <endpoint> --session <name>` to the upstream command.

It rejects any caller-supplied `--cdp*`, `--endpoint`, `--session`, `--browser*`,
`--user-data-dir`, `--port`, or lifecycle verb — those are owned by the shared
runtime.

## Session model

- Default session name: `shared-browser`. Override with
  `BROWSER_PLAYWRIGHT_SESSION`.
- `status` prints the current session descriptor; `attach` writes it; `detach`
  removes it. Detach at the start of a new task before `restart`.

## Install / readiness

Playwright is **not** bundled. Before the first Playwright action in a task, probe
once and cache the result:

```bash
command -v playwright >/dev/null 2>&1 || npm ls playwright >/dev/null 2>&1 && echo READY || echo MISSING
```

If `MISSING`, either:

- Install: `npm i -D playwright && npx playwright install chromium`, or
- Pin a package for the adapter to fetch on demand:

  ```bash
  export BROWSER_PLAYWRIGHT_PACKAGE='playwright@<exact-version>'
  scripts/browser-playwright snapshot
  ```

  `BROWSER_PLAYWRIGHT_PACKAGE` must be an exact spec (`name@x.y.z`); the adapter
  refuses ranges.

If Playwright is unavailable, fall back to read-only CDP diagnostics and
controlled `eval`, and surface the limitation. Do not retry the probe before
every action.

## Runner escape hatch

`BROWSER_PLAYWRIGHT_RUNNER` overrides the executable the adapter invokes, while
preserving the injected environment and arguments. Useful for test harnesses or
local integration layers. Not for normal use.

## Interaction discipline

- Capture a fresh `snapshot` before acting; do not rely on stale refs.
- Identify targets by role, accessible name, visible text, or a stable selector
  — not by fragile DOM paths.
- Prefer `click`/`fill`/`hover`/keyboard over `eval`. `eval` is the last resort
  (see SKILL.md "Browser Operation Boundary").
