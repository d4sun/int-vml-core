import { cn } from "cn"

/** Static numbered pagination matching the design (1 … 20). Presentation only. */
export function Pagination({ current = 1, total = 20 }: { current?: number; total?: number }) {
  const pages = [1, 2, 3, 4]
  return (
    <nav className="flex flex-col items-center gap-2 py-8" aria-label="Pagination">
      <ul className="flex items-center gap-1.5">
        {pages.map((p) => (
          <li key={p}>
            <button
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-sm font-medium transition-colors",
                p === current ? "bg-vml-navy text-white" : "text-vml-ink hover:bg-muted"
              )}
            >
              {p}
            </button>
          </li>
        ))}
        <li className="px-1 text-muted-foreground">…</li>
        <li>
          <button className="flex size-9 items-center justify-center rounded-full text-sm font-medium text-vml-ink hover:bg-muted">
            {total}
          </button>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">Showing results 1–30 of 1,415</p>
    </nav>
  )
}
