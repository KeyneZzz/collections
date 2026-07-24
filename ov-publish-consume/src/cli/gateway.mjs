#!/usr/bin/env node
import { createGateway } from "../gateway/server.mjs";
import { loadGatewayConfig } from "../gateway/config.mjs";
import { OpenVikingClient } from "../ov/client.mjs";

if (process.argv.slice(2).some((arg) => arg === "-h" || arg === "--help")) {
  console.log(`Usage: ov-gateway

Starts the configured read-only OpenViking gateway.
See README.md for environment variables.`);
  process.exit(0);
}

try {
  const config = loadGatewayConfig();
  if (config.host !== "127.0.0.1" && config.host !== "::1" && !config.clientToken) {
    console.warn("WARNING: gateway is not bound to loopback and has no GATEWAY_BEARER_TOKEN");
  }
  const server = createGateway(config, new OpenVikingClient(config));
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : config.port;
    console.log(`OV read gateway listening on http://${config.host}:${port}`);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
