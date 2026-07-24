#!/usr/bin/env node
import { OpenVikingClient } from "../ov/client.mjs";
import { loadPublisherConfig } from "../publisher/config.mjs";
import { publishOnce } from "../publisher/publish.mjs";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: ov-publish [--dry-run]

Publishes the configured Git Markdown subtree as a complete OpenViking resource.
See README.md for environment variables.`);
  process.exit(0);
}
const unknown = args.find((arg) => arg !== "--dry-run");
if (unknown) {
  console.error(`Unknown option: ${unknown}`);
  process.exit(2);
}

try {
  const config = loadPublisherConfig();
  const client = new OpenVikingClient(config);
  await publishOnce(config, client, { dryRun: args.includes("--dry-run") });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
