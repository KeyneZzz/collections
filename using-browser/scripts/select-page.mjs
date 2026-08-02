import { compactTarget, parseArgs, selectPage } from "./cdp.mjs";

export { compactTarget, selectPage };

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint ?? process.env.BROWSER_RUNTIME_CDP_ENDPOINT;
  const pattern = args.pattern ?? process.env.BROWSER_RUNTIME_PAGE_URL_PATTERN;
  const page = await selectPage({ endpoint, pattern });
  console.log(JSON.stringify(compactTarget(page), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
