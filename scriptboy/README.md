# scriptboy

scriptboy is a small intranet script distribution tool. A Node.js server stores the current content for each script alias, and a bash client fetches, verifies, and executes the current script every time.

## Requirements

- Server: Node.js, npm
- Client: bash, curl, mktemp, chmod, sha256sum or shasum

## Server setup

```bash
cd scriptboy/server
npm install
npm run build
node dist/cli.js init --db ../scriptboy.db --store ../store
node dist/cli.js add ../examples/hello.sh --alias hello --desc "hello demo" --db ../scriptboy.db --store ../store
node dist/cli.js serve --host 127.0.0.1 --port 7780 --public-url http://127.0.0.1:7780 --db ../scriptboy.db --store ../store
```

## Install client

In another shell:

```bash
mkdir -p ~/.local/bin
curl -fsSL http://127.0.0.1:7780/install/sb -o ~/.local/bin/sb
chmod +x ~/.local/bin/sb
```

## Use client

```bash
sb doctor
sb list
sb info hello
sb hello John
```

Use `SCRIPTBOY_SERVER` to temporarily point at a different server:

```bash
SCRIPTBOY_SERVER=http://127.0.0.1:7780 sb hello Jane
```

## Behavior

- `sb <alias>` always fetches the current script from the server.
- The client verifies the downloaded content using sha256 before executing it.
- Scripts execute from a temporary file and are removed after execution.
- stdin, stdout, stderr, arguments, and exit code are passed through.
- HTTP APIs are read-only; script registration and updates happen on the server machine via `sb-server`.

## Security boundary

scriptboy assumes a trusted intranet and trusted server host. It does not protect clients if the server is compromised or if malicious users can alter the server-side script store.
