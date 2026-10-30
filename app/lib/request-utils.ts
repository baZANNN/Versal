/** Avoid newer AbortSignal/Response static methods in embedded browsers. */
export function requestDeadline(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), milliseconds);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", abort); },
  };
}

export function jsonResponse(value: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}
