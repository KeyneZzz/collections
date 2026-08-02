# Local Preferences (editable)

Environment-specific defaults vary per user and change often. They live here, not
in the skill body. Edit this file locally; do not commit secrets.

## Browser runtime

```bash
# Chrome/Chromium executable (auto-detected if unset; /usr/bin/chromium-browser on this host)
# export BROWSER_RUNTIME_CHROME=/usr/bin/chromium-browser

# Preferred loopback CDP port
# export BROWSER_RUNTIME_PORT=9222

# Headless by default; set false to see the window
# export BROWSER_RUNTIME_HEADLESS=true
# export BROWSER_RUNTIME_WINDOW_SIZE=1920,1080

# Page selection regex — set this to pin the tab you operate on, e.g. the app
# you are automating. Unset = most recently listed page.
# export BROWSER_RUNTIME_PAGE_URL_PATTERN='example\.com/app'

# Extra Chrome flags (split on shell whitespace)
# export BROWSER_RUNTIME_EXTRA_ARGS='--lang=en-US'
```

## Playwright

```bash
# Deterministic session name
# export BROWSER_PLAYWRIGHT_SESSION=shared-browser

# Pin an exact Playwright package for the adapter to fetch via npm exec
# export BROWSER_PLAYWRIGHT_PACKAGE='playwright@1.99.0'
```

## Eval

```bash
# Allow evals that may have side effects (default: false, throws on side effect)
# export BROWSER_RUNTIME_EVAL_SIDE_EFFECTS=true
```

## Midscene (optional)

Required for the readiness probe to pass; put real values in your shell profile
or a secret manager, never in this file.

```bash
# export MIDSCENE_MODEL_API_KEY="<key>"
# export MIDSCENE_MODEL_BASE_URL="<url>"
# export MIDSCENE_MODEL_NAME="<model>"
# export MIDSCENE_MODEL_FAMILY="<family>"
# export MIDSCENE_MODEL_REASONING_ENABLED="false"

# Adapter knobs
# export BROWSER_MIDSCENE_PACKAGE='@midscene/web@1.2.3'   # exact spec; required to use Midscene
# export BROWSER_MIDSCENE_COMMAND='midscene'
```
