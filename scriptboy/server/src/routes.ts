import express from "express";
import { existsSync } from "fs";
import { openDatabase, getScriptByAlias, initDatabase, listScripts } from "./db";
import { renderInstallScript } from "./install";
import type { ScriptRecord, ServerOptions } from "./models";
import { contentFilePath, validateAlias } from "./store";

function toJson(record: ScriptRecord) {
  return {
    id: record.id,
    alias: record.alias,
    description: record.description,
    sha256: record.sha256,
    size_bytes: record.sizeBytes,
    filename: record.filename,
    enabled: record.enabled,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    created_by: record.createdBy,
    updated_by: record.updatedBy
  };
}

function sanitizeText(value: string): string {
  return value.replace(/[\r\n\t]/g, " ");
}

function getEnabledScript(dbPath: string, alias: string): ScriptRecord | { status: number; message: string } {
  try {
    validateAlias(alias);
  } catch {
    return { status: 404, message: "alias not found" };
  }

  const db = openDatabase(dbPath);
  try {
    initDatabase(db);
    const record = getScriptByAlias(db, alias);
    if (!record) {
      return { status: 404, message: "alias not found" };
    }
    if (!record.enabled) {
      return { status: 410, message: "alias disabled" };
    }
    return record;
  } finally {
    db.close();
  }
}

export function createRouter(options: ServerOptions): express.Router {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/install/sb", async (_req, res, next) => {
    try {
      res.type("text/x-shellscript").send(await renderInstallScript(options.publicUrl));
    } catch (error) {
      next(error);
    }
  });

  router.get("/scripts", (_req, res, next) => {
    try {
      const db = openDatabase(options.dbPath);
      try {
        initDatabase(db);
        const lines = listScripts(db, true).map((record) =>
          [
            record.alias,
            record.sha256,
            String(record.sizeBytes),
            sanitizeText(record.description)
          ].join("\t")
        );
        res.type("text/tab-separated-values").send(lines.length ? `${lines.join("\n")}\n` : "");
      } finally {
        db.close();
      }
    } catch (error) {
      next(error);
    }
  });

  router.get("/scripts/:alias", (req, res) => {
    const result = getEnabledScript(options.dbPath, req.params.alias);
    if ("status" in result) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.json(toJson(result));
  });

  router.get("/scripts/:alias/meta", (req, res) => {
    const result = getEnabledScript(options.dbPath, req.params.alias);
    if ("status" in result) {
      res.status(result.status).type("text/plain").send(`${result.message}\n`);
      return;
    }
    const contentPath = `/scripts/${encodeURIComponent(result.alias)}/content`;
    res.type("text/plain").send(
      [
        `SCRIPTBOY_SCRIPT_ALIAS=${result.alias}`,
        `SCRIPTBOY_SCRIPT_SHA256=${result.sha256}`,
        `SCRIPTBOY_SCRIPT_SIZE_BYTES=${result.sizeBytes}`,
        `SCRIPTBOY_SCRIPT_DESCRIPTION=${sanitizeText(result.description)}`,
        `SCRIPTBOY_SCRIPT_CONTENT_PATH=${contentPath}`
      ].join("\n") + "\n"
    );
  });

  router.get("/scripts/:alias/content", (req, res, next) => {
    try {
      const result = getEnabledScript(options.dbPath, req.params.alias);
      if ("status" in result) {
        res.status(result.status).type("text/plain").send(`${result.message}\n`);
        return;
      }

      const filePath = contentFilePath(options.storeDir, result.contentPath);
      if (!existsSync(filePath)) {
        res.status(500).type("text/plain").send("script content missing\n");
        return;
      }
      res.type("text/plain").sendFile(filePath);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
