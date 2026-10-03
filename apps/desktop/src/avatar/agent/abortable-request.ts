/** Keep timeout and turn cancellation active until the response is consumed. */
export async function withRequestSignal<T>(
  timeoutMs: number,
  outer: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  outer?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(outer?.reason);
  outer?.addEventListener("abort", cancel, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let rejectAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    const value = await Promise.race([request(controller.signal), cancelled]);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    globalThis.clearTimeout(timer);
    outer?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
