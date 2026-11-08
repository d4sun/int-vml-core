"use client"

import { useState } from "react"
import { CalendarDays, Info, MapPin } from "lucide-react"
import { cn } from "cn"

export function EventTabs() {
  const [tab, setTab] = useState<"overview" | "location">("overview")

  return (
    <div>
      <div className="inline-flex rounded-full bg-muted p-1">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "location"} onClick={() => setTab("location")}>
          Location
        </TabButton>
      </div>

      {tab === "overview" ? (
        <div className="mt-6 space-y-6">
          <Row icon={CalendarDays} title="Dates">
            <p className="text-sm text-muted-foreground">12–14 September 2026</p>
          </Row>
          <Row icon={Info} title="About this event">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The Thames Festival is London&apos;s largest free arts festival, celebrating the river that runs
              through the heart of the city. Staged along both banks of the Thames from Westminster to Tower
              Bridge, the weekend-long event features spectacular outdoor arts, music, theatre, and a
              breathtaking fireworks finale.
            </p>
          </Row>
          <Row icon={MapPin} title="Getting there">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Waterloo, London Bridge, or Embankment tube. Events stretch from Westminster Bridge to Tower
              Bridge.
            </p>
          </Row>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-border p-5">
          <p className="text-sm text-muted-foreground">
            Events stretch along both banks of the Thames, from Westminster Bridge in the west to Tower Bridge
            in the east. Nearest stations: Waterloo, Embankment, London Bridge and Tower Hill. See the map below
            for the full festival footprint.
          </p>
        </div>
      )}
    </div>
  )
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-vml-navy text-white" : "text-vml-ink hover:text-vml-navy"
      )}
    >
      {children}
    </button>
  )
}

function Row({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 border-b border-border pb-5 last:border-0">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-vml-navy">
        <Icon className="size-4" />
      </span>
      <div>
        <h3 className="text-sm font-bold text-vml-ink">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}
