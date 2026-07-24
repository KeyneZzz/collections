import { openCdpSession, parseArgs, selectPage } from "./cdp.mjs";

export function buildEvaluateParams(expression, { allowSideEffects = false } = {}) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("expression must be a non-empty string");
  }

  return {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
    throwOnSideEffect: !allowSideEffects,
  };
}

export async function evaluateExpression({
  expression,
  endpoint,
  pattern,
  webSocketDebuggerUrl,
  fetchImpl,
  WebSocketCtor,
  allowSideEffects = false,
} = {}) {
  const wsUrl = webSocketDebuggerUrl ?? (await selectPage({ endpoint, pattern, fetchImpl })).webSocketDebuggerUrl;
  const session = await openCdpSession(wsUrl, { WebSocketCtor });

  try {
    const result = await session.send("Runtime.evaluate", buildEvaluateParams(expression, { allowSideEffects }));
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
    }
    return result.result;
  } finally {
    session.close();
  }
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint ?? process.env.BROWSER_RUNTIME_CDP_ENDPOINT;
  const pattern = args.pattern ?? process.env.BROWSER_RUNTIME_PAGE_URL_PATTERN;
  const expression = args.expression;
  const allowSideEffects = process.env.BROWSER_RUNTIME_EVAL_SIDE_EFFECTS === "true";
  const result = await evaluateExpression({ endpoint, pattern, expression, allowSideEffects });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
