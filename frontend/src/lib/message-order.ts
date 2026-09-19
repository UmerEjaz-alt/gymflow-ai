/** Restores chronological order after a newest-first, database-limited query. */
export function newestFirstToChronological<T>(rows: readonly T[]): T[] {
  return [...rows].reverse();
}
