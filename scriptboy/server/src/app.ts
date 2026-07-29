import express from "express";
import { ensureDir } from "./files";
import { initDatabase, openDatabase } from "./db";
import { createRouter } from "./routes";
import type { ServerOptions } from "./models";

export async function createApp(options: ServerOptions): Promise<express.Express> {
  await ensureDir(options.storeDir);
  const db = openDatabase(options.dbPath);
  try {
    initDatabase(db);
  } finally {
    db.close();
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(createRouter(options));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "internal server error";
    res.status(500).type("text/plain").send(`${message}\n`);
  });
  return app;
}
