# scriptboy protocol

All HTTP APIs are read-only. Script writes happen only through `sb-server` on the server machine.

## Endpoints

### `GET /health`

Returns JSON:

```json
{"ok": true}
```

### `GET /install/sb`

Returns the bash `sb` client with `SCRIPTBOY_DEFAULT_SERVER` rendered from `sb-server serve --public-url`.

### `GET /scripts`

Returns enabled scripts as `text/tab-separated-values` with no header:

```text
alias	sha256	size	description
```

### `GET /scripts/{alias}`

Returns JSON metadata for the current script content.

Disabled aliases return `410`. Unknown aliases return `404`.

### `GET /scripts/{alias}/meta`

Returns shell-friendly metadata. The bash client must parse this as data, not execute it.

```text
SCRIPTBOY_SCRIPT_ALIAS=deploy-app
SCRIPTBOY_SCRIPT_SHA256=...
SCRIPTBOY_SCRIPT_SIZE_BYTES=1234
SCRIPTBOY_SCRIPT_DESCRIPTION=deploy staging
SCRIPTBOY_SCRIPT_CONTENT_PATH=/scripts/deploy-app/content
```

### `GET /scripts/{alias}/content`

Returns the current script content. The client must verify it against `SCRIPTBOY_SCRIPT_SHA256` before execution.
