import { readFile } from "fs/promises";
import path from "path";

const CLIENT_VERSION = "0.1.0";

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function renderInstallScript(publicUrl: string): Promise<string> {
  const templatePath = path.resolve(__dirname, "..", "templates", "sb.sh");
  const template = await readFile(templatePath, "utf8");
  return template
    .replaceAll("__SCRIPTBOY_DEFAULT_SERVER__", shellSingleQuote(publicUrl.replace(/\/+$/, "")))
    .replaceAll("__SCRIPTBOY_CLIENT_VERSION__", shellSingleQuote(CLIENT_VERSION));
}
