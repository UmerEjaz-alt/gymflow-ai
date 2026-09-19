type PerformanceDimensions = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Monotonic elapsed time rounded for compact production logs. */
export function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

/** Starts a server-side timing span outside React's render analysis. */
export function startPerformanceTimer(): number {
  return performance.now();
}

/**
 * Emits timing and cardinality metadata only. Callers must not include message
 * content, transcripts, phone numbers, tokens, or other customer identifiers.
 */
export function logPerformance(
  event: string,
  dimensions: PerformanceDimensions,
): void {
  console.info("[Performance]", { event, ...dimensions });
}
