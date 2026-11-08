"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"

type Item = { q: string; a: string }

export function AccordionList({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {items.map((item, i) => {
        const isOpen = open === i
        return (
          <div key={i}>
            <button
              className="flex w-full items-center justify-between px-4 py-3.5 text-left"
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="text-sm font-medium text-vml-ink">{item.q}</span>
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && <p className="px-4 pb-4 text-sm text-muted-foreground">{item.a}</p>}
          </div>
        )
      })}
    </div>
  )
}
