#!/usr/bin/env node
import { Command } from "commander";
import os from "os";
import { createApp } from "./app";
import { initDatabase, insertScript, listScripts, getScriptByAlias, openDatabase, setEnabled, updateScript } from "./db";
import { defaultPublicUrl, resolveDbPath, resolveStoreDir } from "./config";
import { ensureDir } from "./files";
import { storeScriptFile, validateAlias } from "./store";

function operator(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || "unknown";
  }
}

function descOption(value: string | undefined): string {
  return value ?? "";
}

function printRecord(record: ReturnType<typeof listScripts>[number]): void {
  console.log(`alias: ${record.alias}`);
  console.log(`description: ${record.description}`);
  console.log(`sha256: ${record.sha256}`);
  console.log(`size_bytes: ${record.sizeBytes}`);
  console.log(`filename: ${record.filename}`);
  console.log(`enabled: ${record.enabled ? "true" : "false"}`);
  console.log(`updated_at: ${record.updatedAt}`);
  console.log(`updated_by: ${record.updatedBy}`);
}

async function withDb<T>(dbPath: string, fn: (db: ReturnType<typeof openDatabase>) => T): Promise<T> {
  const db = openDatabase(resolveDbPath(dbPath));
  try {
    initDatabase(db);
    return fn(db);
  } finally {
    db.close();
  }
}

function addDbStoreOptions(command: Command): Command {
  return command
    .option("--db <path>", "SQLite db path", "./scriptboy.db")
    .option("--store <path>", "script content store directory", "./store");
}

async function main(): Promise<void> {
  const program = new Command();
  program.name("sb-server").description("scriptboy server and local management CLI").version("0.1.0");

  addDbStoreOptions(program.command("init"))
    .description("initialize the SQLite database and content store")
    .action(async (options) => {
      const dbPath = resolveDbPath(options.db);
      const storeDir = resolveStoreDir(options.store);
      await ensureDir(storeDir);
      await withDb(dbPath, () => undefined);
      console.log(`initialized db=${dbPath} store=${storeDir}`);
    });

  addDbStoreOptions(program.command("add"))
    .argument("<file>", "script file")
    .requiredOption("--alias <alias>", "script alias")
    .option("--desc <description>", "script description")
    .description("add a new script alias")
    .action(async (file, options) => {
      validateAlias(options.alias);
      const stored = await storeScriptFile(file, resolveStoreDir(options.store));
      const record = await withDb(options.db, (db) =>
        insertScript(db, {
          alias: options.alias,
          description: descOption(options.desc),
          operator: operator(),
          ...stored
        })
      );
      printRecord(record);
    });

  addDbStoreOptions(program.command("update"))
    .argument("<alias>", "script alias")
    .argument("<file>", "script file")
    .option("--desc <description>", "script description")
    .description("replace the current content for an alias")
    .action(async (alias, file, options) => {
      validateAlias(alias);
      const stored = await storeScriptFile(file, resolveStoreDir(options.store));
      const existing = await withDb(options.db, (db) => getScriptByAlias(db, alias));
      if (!existing) {
        throw new Error(`Unknown alias: ${alias}`);
      }
      const record = await withDb(options.db, (db) =>
        updateScript(db, alias, {
          description: options.desc ?? existing.description,
          operator: operator(),
          ...stored
        })
      );
      printRecord(record);
    });

  addDbStoreOptions(program.command("list"))
    .description("list scripts")
    .action(async (options) => {
      const records = await withDb(options.db, (db) => listScripts(db, false));
      for (const record of records) {
        console.log(
          [
            record.enabled ? "enabled" : "disabled",
            record.alias,
            record.sha256,
            record.sizeBytes,
            record.description
          ].join("\t")
        );
      }
    });

  addDbStoreOptions(program.command("info"))
    .argument("<alias>", "script alias")
    .description("show script metadata")
    .action(async (alias, options) => {
      validateAlias(alias);
      const record = await withDb(options.db, (db) => getScriptByAlias(db, alias));
      if (!record) {
        throw new Error(`Unknown alias: ${alias}`);
      }
      printRecord(record);
    });

  addDbStoreOptions(program.command("disable"))
    .argument("<alias>", "script alias")
    .description("disable a script alias")
    .action(async (alias, options) => {
      validateAlias(alias);
      const record = await withDb(options.db, (db) => setEnabled(db, alias, false, operator()));
      printRecord(record);
    });

  addDbStoreOptions(program.command("enable"))
    .argument("<alias>", "script alias")
    .description("enable a script alias")
    .action(async (alias, options) => {
      validateAlias(alias);
      const record = await withDb(options.db, (db) => setEnabled(db, alias, true, operator()));
      printRecord(record);
    });

  addDbStoreOptions(program.command("serve"))
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--port <port>", "bind port", "7780")
    .option("--public-url <url>", "public base URL for rendered bash client")
    .description("run the read-only HTTP server")
    .action(async (options) => {
      const host = options.host;
      const port = Number.parseInt(options.port, 10);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid port: ${options.port}`);
      }
      const app = await createApp({
        dbPath: resolveDbPath(options.db),
        storeDir: resolveStoreDir(options.store),
        publicUrl: (options.publicUrl ?? defaultPublicUrl(host, port)).replace(/\/+$/, "")
      });
      app.listen(port, host, () => {
        console.log(`scriptboy server listening on ${host}:${port}`);
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sb-server: ${message}`);
  process.exit(1);
});
