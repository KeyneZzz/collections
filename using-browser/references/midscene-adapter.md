# Midscene Adapter (optional)

Midscene is an **optional** visual/semantic capability. Playwright remains the
default interaction engine. Use Midscene only when a visible target cannot be
identified deterministically, or when the user explicitly requests it. The skill
agent owns planning, sequencing, and recovery; Midscene executes **one visible
terminal action at a time**.

Midscene is inert unless its model env vars are set: on a host without
`MIDSCENE_MODEL_*`, `browser-midscene-ready` reports unavailable and you continue
with Playwright.

> Unless explicitly changed, `act`, `--deep-think`, and `--deep-locate` are
> **forbidden** in this skill.

## Environment

Put real URL/key values in your shell profile or a secret manager — do **not**
commit real secrets. The readiness probe can pass only when these are all set:

```bash
export MIDSCENE_MODEL_API_KEY="<your-midscene-api-key>"
export MIDSCENE_MODEL_BASE_URL="<your-midscene-base-url>"
export MIDSCENE_MODEL_NAME="<model-name>"
export MIDSCENE_MODEL_FAMILY="<model-family>"
export MIDSCENE_MODEL_REASONING_ENABLED="false"   # agent owns planning/recovery
```

Optional planning / insight models (may point to the same service):

```bash
export MIDSCENE_PLANNING_MODEL_API_KEY="<...>"
export MIDSCENE_PLANNING_MODEL_BASE_URL="<...>"
export MIDSCENE_PLANNING_MODEL_NAME="<model-name>"
export MIDSCENE_INSIGHT_MODEL_API_KEY="<...>"
export MIDSCENE_INSIGHT_MODEL_BASE_URL="<...>"
export MIDSCENE_INSIGHT_MODEL_NAME="<model-name>"
```

Adapter knobs:

| Variable | Default | Meaning |
|---|---|---|
| `BROWSER_MIDSCENE_PACKAGE` | unset | Exact Midscene npm spec, e.g. `@midscene/web@1.2.3` (required to use Midscene) |
| `BROWSER_MIDSCENE_COMMAND` | `midscene` | CLI command inside the package |
| `BROWSER_MIDSCENE_RUNNER` | unset | Override executable for tests/local adapters |

## Readiness

Run `scripts/browser-midscene-ready` once, at the first step that actually needs
Midscene, and cache the result for the task. Do not run it during routine setup
or before every action.

- It checks the model env vars first. If any required `MIDSCENE_MODEL_*` var is
  missing, it reports Midscene **unavailable** and exits nonzero **without
  starting Chrome**.
- A passing static probe confirms local config and prerequisites only. It does
  **not** prove the model endpoint, credentials, or selected model are usable.
  The first real terminal action is the service check.
- If the probe fails, or the first action exposes a model/config failure, mark
  Midscene unavailable for the task and continue with Playwright. An ordinary
  locate or UI-action failure is **not** an availability failure (use the
  failure flow below).

## Core principles

- **Do not use `act`** — don't hand multi-step intent to Midscene for autonomous
  planning.
- **Do not use `--deep-think`** — complex reasoning belongs to the agent.
- **Do not use `--deep-locate`** — handle locate failures with a more specific
  prompt, screenshot review, CDP diagnostics, or a safe low-level fallback.
- **Run one terminal action per command** (one `tap`, one `input`, one `hover`).
- **Use only `scripts/browser-midscene`** — it resolves the current shared
  endpoint, exports `MIDSCENE_CDP_ENDPOINT`, and adds the bare `--cdp` mode flag.
  The env var alone does not enable CDP mode; without the flag, upstream Midscene
  would silently use its own Puppeteer browser.
- **Do not use Midscene `close`** — browser lifecycle belongs to `browser-runtime`;
  the wrapper rejects upstream close/quit/kill verbs.
- **Reset at the task boundary, reuse within the task** — `browser-runtime
  restart <url>` before the first browser action of a new task; keep that
  endpoint for the rest of the task.
- **Refresh state across engine changes** — snapshot refs, locate results, and
  coordinates are engine- and state-specific. After every switch, capture a fresh
  Playwright snapshot before continuing; after a Midscene action, refresh the
  Playwright snapshot before the next action. Never reuse a pre-switch ref.

## Command template

```bash
scripts/browser-midscene <command> <options>
```

Use `scripts/browser-midscene help <command>` or
`scripts/browser-midscene <command> --help` for the full parameter list from the
installed Midscene version. Help does not require a running browser. Do not
invoke `npx @midscene/web` directly or pass `--cdp`; the wrapper owns that
connection contract.

Forbidden:

```bash
# Hands multi-step intent to Midscene for autonomous planning
scripts/browser-midscene act --prompt "..."

# Complex reasoning / aggressive locating belong to the agent, not flags
scripts/browser-midscene tap --deep-think   --locate '{"prompt":"..."}'
scripts/browser-midscene tap --deep-locate  --locate '{"prompt":"..."}'
```

## Locate JSON

Most terminal actions take `--locate`, a JSON string whose common shape is:

```bash
--locate '{"prompt":"the exact visible target"}'
```

Rules:

- Describe the specific **visible** target, not the business intent.
- Include local context: row/column/region name, button text, relative position.
- Avoid vague targets like `the button` or `the row`.
- Do not put a multi-step flow into a locate prompt.

Good:

```bash
--locate '{"prompt":"the Add button in the row named accounts"}'
--locate '{"prompt":"the search input in the top-right of the page"}'
--locate '{"prompt":"the Continue button in the top-right toolbar"}'
```

Bad:

```bash
--locate '{"prompt":"add the field and continue"}'
--locate '{"prompt":"the button"}'
```

## Allowed terminal actions

| Action | Use for |
|---|---|
| `tap` | click buttons, menu items, tabs, checkboxes, visible rows |
| `rightclick` | context menus on cards/rows/headers |
| `hover` | reveal hover-only controls; split into `hover` then inspect/`tap` |
| `input` | type final text into a field (`--value`, modes `replace`/`typeOnly`/`clear`) |
| `clearinput` | clear a field |
| `keyboardpress` | press a key/combo (`--keyName Enter`, `ArrowDown`, `Control+A`); not for typing text |
| `cursormove` | move the text cursor (`--direction`, `--times`) |
| `scroll` | page or local container (`--direction`, `--distance`, `--scrollType`) |
| `swipe` | sliders/carousels/swipe-to-dismiss (prefer `scroll` for desktop) |
| `draganddrop` | drag one element onto another (`--from`, `--to`) |
| `take_screenshot` | capture state for review/planning |
| `assert` | natural-language visible-state assertion (no UI action) |

## Operation mapping

| Intent | Midscene action |
|---|---|
| click / select / choose | `tap --locate ...` |
| hover to reveal, then act | `hover --locate ...` then `tap --locate ...` |
| type / search / filter | `input --value ... --locate ...` |
| clear | `clearinput --locate ...` or `input --mode clear` |
| press Enter / Arrow / Esc | `keyboardpress --keyName ...` |
| right-click | `rightclick --locate ...` |
| scroll list / grid | `scroll --locate ... --direction ... --distance ...` |
| verify visible state | `take_screenshot` + agent inspection, or `assert` |

## Failure handling

When a terminal action fails or locates the wrong target:

1. Capture a fresh Playwright snapshot or `take_screenshot` to review state.
2. Prefer a deterministic Playwright role/text/selector action if the target is
   now identifiable.
3. If visual recognition is still required, rewrite the locate prompt to be more
   specific (region, row name, text, relative position).
4. Consult your own product knowledge for UI rules, hover rules, selector/test-id
   clues, or known pitfalls.
5. Use read-only CDP diagnostics (`browser-runtime`) to inspect URL, console,
   network, cookies, auth state.
6. If a fresh screenshot/read-only geometry gives a coordinate for a visible
   target, use a minimal `browser-playwright` mouse sequence and verify with a
   fresh snapshot. For a documented event-sequence trap that native Playwright
   cannot produce, use the smallest event-only `browser-runtime eval` and verify
   immediately — never for discovery, ordinary input, or state/API/network
   mutation.

## Performance notes

- A single terminal action commonly takes several seconds; complex cases can take
  much longer.
- The cost driver is multi-round reasoning, which is why `act` (autonomous
  planning) is forbidden and one-action-per-command is the rule.

Use Midscene terminal actions only for steps that benefit from visual/semantic
recognition; keep Playwright as the default.
