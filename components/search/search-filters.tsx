import Link from "next/link"
import type { SearchCategory } from "@/lib/search/service"

/** The values currently applied, as the form shows them. */
export type AppliedFilters = {
  q?: string
  category?: string
  date?: string
  minPounds?: number
  maxPounds?: number
  /** The map area, kept when the filters change so it is not lost. */
  area?: { south: number; north: number; west: number; east: number }
}

/**
 * A plain GET form to /explore, so filters work without JavaScript and every
 * result is a shareable URL. Prices are entered in pounds.
 */
export function SearchFilters({
  categories,
  applied,
}: {
  categories: SearchCategory[]
  applied: AppliedFilters
}) {
  return (
    <form
      action="/explore"
      method="get"
      aria-label="Filter places"
      className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <div className="space-y-1.5">
        <label htmlFor="filter-q" className="text-sm font-medium text-vml-ink">
          Search
        </label>
        <input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={applied.q ?? ""}
          maxLength={100}
          placeholder="Tower, walk, gallery…"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="filter-category"
          className="text-sm font-medium text-vml-ink"
        >
          Category
        </label>
        <select
          id="filter-category"
          name="category"
          defaultValue={applied.category ?? ""}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="filter-date"
          className="text-sm font-medium text-vml-ink"
        >
          Date
        </label>
        <input
          id="filter-date"
          name="date"
          type="date"
          defaultValue={applied.date ?? ""}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-vml-ink">Price (£)</legend>
        <div className="flex items-center gap-2">
          <label htmlFor="filter-min" className="sr-only">
            Minimum price in pounds
          </label>
          <input
            id="filter-min"
            name="minPounds"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={applied.minPounds ?? ""}
            placeholder="Min"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
          <label htmlFor="filter-max" className="sr-only">
            Maximum price in pounds
          </label>
          <input
            id="filter-max"
            name="maxPounds"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={applied.maxPounds ?? ""}
            placeholder="Max"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      </fieldset>

      {applied.area ? (
        <>
          <input type="hidden" name="south" value={applied.area.south} />
          <input type="hidden" name="north" value={applied.area.north} />
          <input type="hidden" name="west" value={applied.area.west} />
          <input type="hidden" name="east" value={applied.area.east} />
        </>
      ) : null}

      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
        <button
          type="submit"
          className="rounded-xl bg-vml-navy px-4 py-2 text-sm font-semibold text-white"
        >
          Apply filters
        </button>
        <Link
          href="/explore"
          className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  )
}
