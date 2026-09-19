type WorkspaceLoadingProps = {
  detailPanel?: boolean;
  rows?: number;
};

/** Dashboard-shaped loading shell used by dynamic authenticated routes. */
export function WorkspaceLoading({
  detailPanel = true,
  rows = 5,
}: WorkspaceLoadingProps) {
  return (
    <div
      aria-label="Loading workspace"
      aria-live="polite"
      className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-muted size-9 animate-pulse rounded-lg" />
        <div className="space-y-2">
          <div className="bg-muted h-5 w-32 animate-pulse rounded" />
          <div className="bg-muted h-3 w-64 max-w-[65vw] animate-pulse rounded" />
        </div>
      </div>
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        <div className="border-border border-b p-4">
          <div className="bg-muted h-9 w-full animate-pulse rounded-md" />
        </div>
        <div
          className={
            detailPanel ? "grid lg:grid-cols-[minmax(0,1fr)_380px]" : undefined
          }
        >
          <div className="divide-border divide-y">
            {Array.from({ length: rows }, (_, index) => (
              <div className="flex items-center gap-3 p-4" key={index}>
                <div className="bg-muted size-9 shrink-0 animate-pulse rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="bg-muted h-4 w-40 animate-pulse rounded" />
                  <div className="bg-muted h-3 w-3/5 animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
          {detailPanel ? (
            <div className="border-border hidden space-y-3 border-l p-5 lg:block">
              <div className="bg-muted h-5 w-36 animate-pulse rounded" />
              <div className="bg-muted h-3 w-48 animate-pulse rounded" />
              <div className="bg-muted mt-8 h-20 animate-pulse rounded-lg" />
              <div className="bg-muted h-14 animate-pulse rounded-lg" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
