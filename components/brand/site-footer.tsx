import Link from "next/link"
import { Globe, AtSign, Camera, Film, Rss, Mail } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { FOOTER_COLUMNS } from "@/lib/mock-data"

// NOTE: lucide-react@1.70.0 (pinned in this repo) ships only generic glyphs —
// brand icons (Facebook/Instagram/YouTube/Twitter) were removed from lucide for
// trademark reasons. We use neutral social-shaped icons as placeholders; swap for
// real brand marks (e.g. simple-icons or inline SVGs) when wiring the footer up.

/** Footer — spec: pure black, 56px/32px padding, 1400px content, Urbanist-700
 *  uppercase column headings, Geist-14 links at 50% white, 36px social circles,
 *  legal bar with an 8%-white top rule. */
export function SiteFooter() {
  return (
    <footer className="bg-black text-white/50">
      <div className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-8">
          {/* Brand column */}
          <div className="lg:w-[360px] lg:shrink-0">
            <Logo tone="light" />
            <p className="mt-5 max-w-[320px] text-sm leading-[23px] text-white/50">
              London&apos;s premier independent travel guide — your complete resource for exploring,
              experiencing, and loving London.
            </p>
            <div className="mt-5 flex gap-2">
              {[AtSign, Globe, Camera, Film, Rss, Mail].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white transition-colors hover:bg-white/15"
                  aria-label="Social link"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.heading}>
                <h5 className="font-heading text-sm font-bold tracking-[0.7px] text-white uppercase">
                  {col.heading}
                </h5>
                <ul className="mt-4 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-sm text-white/50 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Legal bar */}
        <div className="mt-12 flex flex-col gap-3 border-t border-white/[0.08] pt-6 text-xs text-white/30 sm:flex-row sm:items-center sm:justify-between">
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
