export interface ScriptRecord {
  id: number;
  alias: string;
  description: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  contentPath: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface ScriptInput {
  alias: string;
  description: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  contentPath: string;
  operator: string;
}

export interface ServerOptions {
  dbPath: string;
  storeDir: string;
  publicUrl: string;
}
