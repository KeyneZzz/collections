# OV Publish / Consume

A business-neutral reference implementation for maintaining an OpenViking
resource from a Git-controlled Markdown tree and exposing that resource through
a constrained, read-only gateway.

The project demonstrates three boundaries:

1. **Publish**: pin a Git revision, validate and archive a Markdown subtree,
   upload it, wait for parsing, verify the derived projection, and record state.
2. **Gateway**: retain the OpenViking credential server-side and expose only a
   fixed set of read operations beneath configured resource roots.
3. **Consume**: query the gateway without knowing the OpenViking endpoint or
   credential.

This is a mechanism reference, not an official OpenViking SDK.

## Requirements

- Node.js 22 or newer
- Git
- An OpenViking deployment compatible with the endpoints used in
  `src/ov/client.mjs`

There are no npm runtime dependencies.

## Publish

```bash
export OV_BASE_URL=https://openviking.example
export OV_API_KEY=replace-me
export OV_RESOURCE_ROOT=viking://resources/example
export OV_SOURCE_NAME=example
export OV_REPO_ROOT=/path/to/repository
export OV_SOURCE_DIR=knowledge

npm exec -- ov-publish --dry-run
npm exec -- ov-publish
```

The publisher reads `OV_GIT_REF` (default `HEAD`) without changing the working
tree. It publishes a complete ZIP snapshot rather than applying individual file
mutations.

## Gateway

```bash
export OV_BASE_URL=https://openviking.example
export OV_API_KEY=replace-me
export OV_ALLOWED_ROOTS=viking://resources/example
export GATEWAY_BEARER_TOKEN=choose-a-client-token

npm exec -- ov-gateway
```

The server binds to `127.0.0.1:3000` by default. When binding to a non-loopback
address, configure `GATEWAY_BEARER_TOKEN` or put authenticated ingress in front
of the process.

## Consume

```bash
export OV_GATEWAY_URL=http://127.0.0.1:3000
export OV_GATEWAY_TOKEN=choose-a-client-token

npm exec -- ov-consume find "how snapshots are verified"
npm exec -- ov-consume list viking://resources/example
npm exec -- ov-consume read viking://resources/example/topic/parsed-file.md
```

Run `ov-consume help` for all read operations.

## Configuration

Publisher variables:

| Variable | Default | Meaning |
|---|---|---|
| `OV_BASE_URL` | required | OpenViking HTTP base URL |
| `OV_API_KEY` | required | Server-side publishing credential |
| `OV_RESOURCE_ROOT` | required | Resource URI owned by this publisher |
| `OV_SOURCE_NAME` | required | Source name sent with the archive |
| `OV_REPO_ROOT` | current directory | Git repository |
| `OV_SOURCE_DIR` | `knowledge` | Markdown subtree inside Git |
| `OV_GIT_REF` | `HEAD` | Commit or ref to archive |
| `OV_STATE_DIR` | `.ov-state` | Local lock and publication state |

Gateway variables:

| Variable | Default | Meaning |
|---|---|---|
| `OV_ALLOWED_ROOTS` | required | Comma-separated readable resource roots |
| `GATEWAY_HOST` | `127.0.0.1` | Listen address |
| `GATEWAY_PORT` | `3000` | Listen port |
| `GATEWAY_BEARER_TOKEN` | unset | Optional client bearer token |

Shared limits are configured with `OV_TIMEOUT_MS`, `OV_MAX_RESPONSE_BYTES`,
`OV_TASK_TIMEOUT_MS`, and `OV_TASK_POLL_INTERVAL_MS`.

## Security Model

- Publishing and upstream credentials never pass through gateway responses.
- Resource URIs are checked against explicit roots before any upstream request.
- The gateway has no generic proxy and no write endpoint.
- Publisher state is written with user-only permissions.
- Archive content is taken from a pinned Git object, not the mutable checkout.

## Verify

```bash
npm run verify
```
