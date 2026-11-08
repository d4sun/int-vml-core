"use client"

import { useState } from "react"
import { Calendar, Lock, Smartphone, RefreshCw, Gift, Minus, Plus, Star } from "lucide-react"
import { Button } from "@/components/ui/button"

type TicketType = { id: string; label: string; sublabel: string; price: string }

const TICKETS: TicketType[] = [
  { id: "adult", label: "Adult", sublabel: "Ages 16+ · £37.00", price: "£37.00" },
  { id: "child", label: "Child", sublabel: "Ages 5–15 · £19.90", price: "£19.90" },
  { id: "concession", label: "Concession", sublabel: "Students & 60+ · £29.50", price: "£29.50" },
  { id: "family", label: "Family", sublabel: "2 adults + up to 3 children · £95.00", price: "£95.00" },
]

export function BookingWidget() {
  const [qty, setQty] = useState<Record<string, number>>({})
  const set = (id: string, delta: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + delta) }))

  return (
    <div className="sticky top-24 overflow-hidden rounded-2xl border border-border shadow-sm">
      <div className="bg-vml-navy p-5 text-white">
        <p className="text-sm text-white/80">
          from <span className="text-2xl font-bold text-white">£37.00</span> / person
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-white/80">
          <Star className="size-3 fill-current text-vml-red" /> 4.8 (2,847 reviews)
        </p>
        <p className="mt-2 text-xs text-white/70">Skip the queue · Free cancellation</p>
      </div>

      <div className="bg-card p-5">
        <label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Select visit date
        </label>
        <button className="mt-2 flex h-11 w-full items-center justify-between rounded-lg border border-border px-3 text-sm text-muted-foreground">
          Choose a date
          <Calendar className="size-4" />
        </button>

        <p className="mt-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Ticket types
        </p>
        <div className="mt-2 space-y-3">
          {TICKETS.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-vml-ink">{t.label}</p>
                <p className="truncate text-xs text-muted-foreground">{t.sublabel}</p>
              </div>
              <Stepper value={qty[t.id] ?? 0} onChange={(d) => set(t.id, d)} />
            </div>
          ))}
        </div>

        <Button className="mt-5 h-11 w-full rounded-lg bg-vml-red text-white hover:bg-vml-red/90">
          Select tickets to continue
        </Button>

        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          <li className="flex items-center gap-2"><Lock className="size-3.5" /> Secure payment via SSL encryption</li>
          <li className="flex items-center gap-2"><Smartphone className="size-3.5" /> Mobile tickets — no printing needed</li>
          <li className="flex items-center gap-2"><RefreshCw className="size-3.5" /> Free date change up to 24h before</li>
        </ul>

        <button className="mt-4 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-vml-red">
          <Gift className="size-4" /> Buy as a gift
        </button>
      </div>
    </div>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <StepBtn onClick={() => onChange(-1)} disabled={value === 0}>
        <Minus className="size-3.5" />
      </StepBtn>
      <span className="w-5 text-center text-sm font-semibold text-vml-ink">{value}</span>
      <StepBtn onClick={() => onChange(1)}>
        <Plus className="size-3.5" />
      </StepBtn>
    </div>
  )
}

function StepBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-full border border-border text-vml-ink transition-colors hover:bg-muted disabled:opacity-40"
    >
      {children}
    </button>
  )
}
