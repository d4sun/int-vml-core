"use client"

import { useState } from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import type { FacetGroup } from "@/lib/mock-data"

export function FilterSidebar({ facets, showPlaces }: { facets: FacetGroup[]; showPlaces: number }) {
  return (
    <aside className="w-full shrink-0 lg:w-64">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-vml-ink">Advanced Filters</h2>
          <button className="text-sm font-medium text-vml-red hover:underline">Clear all</button>
        </div>

        <div className="mt-4 divide-y divide-border">
          {facets.map((group) => (
            <FacetBlock key={group.heading} group={group} />
          ))}
        </div>

        <Button className="mt-4 h-10 w-full rounded-lg bg-vml-navy text-white hover:bg-vml-navy/90">
          Show {showPlaces} places
        </Button>
      </div>
    </aside>
  )
}

function FacetBlock({ group }: { group: FacetGroup }) {
  const [open, setOpen] = useState(group.options.length > 0)
  const empty = group.options.length === 0

  return (
    <div className="py-3 first:pt-0">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-semibold text-vml-ink">{group.heading}</span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && !empty && (
        <ul className="mt-3 space-y-2.5">
          {group.options.map((opt) => (
            <li key={opt.label}>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-vml-ink">
                <Checkbox />
                <span className="flex-1">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.count}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Checkbox() {
  const [checked, setChecked] = useState(false)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => setChecked((v) => !v)}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked ? "border-vml-navy bg-vml-navy text-white" : "border-input bg-background"
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="size-3" fill="none">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
