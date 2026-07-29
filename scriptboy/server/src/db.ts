import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import type { ScriptInput, ScriptRecord } from "./models";

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

export function initDatabase(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      filename TEXT NOT NULL,
      content_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scripts_enabled_alias
      ON scripts(enabled, alias);
  `);
}

function normalize(row: any): ScriptRecord {
  return {
    id: row.id,
    alias: row.alias,
    description: row.description,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    filename: row.filename,
    contentPath: row.content_path,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}

export function insertScript(db: Db, input: ScriptInput): ScriptRecord {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO scripts (
      alias, description, sha256, size_bytes, filename, content_path,
      enabled, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `);
  stmt.run(
    input.alias,
    input.description,
    input.sha256,
    input.sizeBytes,
    input.filename,
    input.contentPath,
    now,
    now,
    input.operator,
    input.operator
  );
  const record = getScriptByAlias(db, input.alias);
  if (!record) {
    throw new Error(`Failed to insert script: ${input.alias}`);
  }
  return record;
}

export function updateScript(db: Db, alias: string, input: Omit<ScriptInput, "alias">): ScriptRecord {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE scripts
    SET description = ?,
        sha256 = ?,
        size_bytes = ?,
        filename = ?,
        content_path = ?,
        updated_at = ?,
        updated_by = ?
    WHERE alias = ?
  `);
  const result = stmt.run(
    input.description,
    input.sha256,
    input.sizeBytes,
    input.filename,
    input.contentPath,
    now,
    input.operator,
    alias
  );
  if (result.changes === 0) {
    throw new Error(`Unknown alias: ${alias}`);
  }
  const record = getScriptByAlias(db, alias);
  if (!record) {
    throw new Error(`Failed to update script: ${alias}`);
  }
  return record;
}

export function setEnabled(db: Db, alias: string, enabled: boolean, operator: string): ScriptRecord {
  const stmt = db.prepare(`
    UPDATE scripts
    SET enabled = ?, updated_at = ?, updated_by = ?
    WHERE alias = ?
  `);
  const result = stmt.run(enabled ? 1 : 0, new Date().toISOString(), operator, alias);
  if (result.changes === 0) {
    throw new Error(`Unknown alias: ${alias}`);
  }
  const record = getScriptByAlias(db, alias);
  if (!record) {
    throw new Error(`Failed to update script: ${alias}`);
  }
  return record;
}

export function getScriptByAlias(db: Db, alias: string): ScriptRecord | null {
  const row = db.prepare("SELECT * FROM scripts WHERE alias = ?").get(alias);
  return row ? normalize(row) : null;
}

export function listScripts(db: Db, enabledOnly = false): ScriptRecord[] {
  const sql = enabledOnly
    ? "SELECT * FROM scripts WHERE enabled = 1 ORDER BY alias"
    : "SELECT * FROM scripts ORDER BY alias";
  return db.prepare(sql).all().map(normalize);
}
