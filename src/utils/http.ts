type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

export async function fetchWithTimeout(
  input: FetchInput,
  options: FetchOptions & {
    timeoutMs: number;
  }
) {
  const { timeoutMs, signal, ...rest } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  return fetch(input, {
    ...rest,
    signal: combinedSignal
  });
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
