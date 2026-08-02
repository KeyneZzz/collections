# Trace Privacy

Network/console trace capture is conservative by default. This is deliberate:
trace files live on disk and can be shared by accident.

## Defaults

- **URL query strings are stripped** (and fragment). Only the origin + path is
  recorded. Override with `BROWSER_TRACE_INCLUDE_QUERY=true`.
- **Request/response headers are omitted** entirely. Override with
  `BROWSER_TRACE_CAPTURE_HEADERS=true`.
- **Request/response bodies are omitted** entirely. Override with
  `BROWSER_TRACE_CAPTURE_BODIES=true`.

## Sensitive headers (always redacted)

Even when `BROWSER_TRACE_CAPTURE_HEADERS=true`, these are written as
`[redacted]`:

- `authorization`, `proxy-authorization`, `cookie`, `set-cookie`
- any header whose lowercased name contains `token`, `secret`, or `api-key`

There is no flag to disable this redaction.

## Guidance

- Enable body/header/query capture only for the specific task that needs them,
  and clear the trace (`trace clear`) when done.
- Do not paste raw trace dumps into chat, commits, or external services without
  review — bodies can contain application data even when headers are redacted.
- Keep the runtime state directory private; do not publish `trace.jsonl`.
