import Link from "next/link"
import { Globe, AtSign, Camera, Film, Rss, Mail } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { FOOTER_COLUMNS } from "@/lib/mock-data"

// NOTE: lucide-react@1.70.0 (pinned in this repo) ships only generic glyphs —
// brand icons (Facebook/Instagram/YouTube/Twitter) were removed from lucide for
// trademark reasons. We use neutral social-shaped icons as placeholders; swap for
// real brand marks (e.g. simple-icons or inline SVGs) when wiring the footer up.

export function SiteFooter() {
  return (
    <footer className="bg-vml-ink text-white/70">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-7">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-2">
            <Logo tone="light" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
              London&apos;s premier independent travel guide — your complete resource for exploring,
              experiencing, and loving London.
            </p>
            <div className="mt-5 flex gap-2">
              {[AtSign, Globe, Camera, Film, Rss, Mail].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex size-8 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Social link"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-bold tracking-widest text-white uppercase">{col.heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-white/60 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 VisitMyLondon.com.uk — All rights reserved. London&apos;s #1 independent travel guide.</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/legal/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link href="/legal/cookies" className="hover:text-white">Cookie Policy</Link>
            <Link href="/legal/terms" className="hover:text-white">Terms &amp; Conditions</Link>
            <Link href="/legal/booking-terms" className="hover:text-white">Booking Terms</Link>
            <Link href="/legal/affiliate-disclosure" className="hover:text-white">Affiliate Disclosure</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
