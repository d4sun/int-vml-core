"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { ChevronDown, Search, Menu, Globe, X } from "lucide-react"
import { cn } from "cn"
import { Logo } from "@/components/brand/logo"
import { PRIMARY_NAV, type NavItem } from "@/lib/mock-data"

export function SiteHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Deep-navy utility bar (#012173, 88px) */}
      <div className="bg-vml-navy-deep text-white">
        <div className="mx-auto flex h-[88px] max-w-[1410px] items-center gap-4 px-4 sm:px-6">
          <Logo tone="light" />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <label className="relative hidden items-center sm:flex">
              <Search className="pointer-events-none absolute left-4 size-3.5 text-white/70" />
              <input
                placeholder="Search"
                className="h-10 w-[200px] rounded-full border border-[#465B94] bg-white/[0.08] pr-4 pl-10 text-xs text-white placeholder:text-white/70 outline-none focus:border-white/50"
              />
            </label>
            <IconButton label="Currency">
              <span className="font-heading text-[18px] font-bold">$</span>
            </IconButton>
            <IconButton label="Language">
              <Globe className="size-[22px]" />
            </IconButton>
            <IconButton label="Menu" onClick={() => setMobileOpen((v) => !v)} className="lg:hidden">
              {mobileOpen ? <X className="size-[22px]" /> : <Menu className="size-[22px]" />}
            </IconButton>
          </div>
        </div>
      </div>

      {/* White primary nav (80px) */}
      <nav className="hidden h-20 border-b border-border bg-white lg:flex lg:items-center">
        <div className="mx-auto flex w-full max-w-[1410px] items-center gap-1 px-4 sm:px-6">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.label} item={item} pathname={pathname} />
          ))}
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-b border-border bg-white lg:hidden">
          <ul className="mx-auto max-w-[1410px] px-4 py-2 sm:px-6">
            {PRIMARY_NAV.map((item) => (
              <li key={item.label} className="border-b border-border/60 last:border-0">
                <Link
                  href={item.href}
                  className="block py-2.5 text-sm font-medium text-vml-ink"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  const hasChildren = !!item.children?.length

  if (!hasChildren) {
    return (
      <Link
        href={item.href}
        className={cn(
          "font-heading rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors",
          active
            ? "bg-vml-red text-white"
            : "text-vml-navy hover:bg-muted"
        )}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <div className="group relative">
      <button
        className={cn(
          "font-heading flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors",
          active ? "bg-vml-red text-white" : "text-vml-navy hover:bg-muted"
        )}
      >
        {item.label}
        <ChevronDown className="size-3 opacity-40 transition-transform group-hover:rotate-180" />
      </button>
      <div className="invisible absolute top-full left-0 z-50 min-w-52 translate-y-1 rounded-xl border border-border bg-white p-1.5 opacity-0 shadow-lg transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
        {item.children!.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="block rounded-lg px-3 py-2 text-sm text-vml-ink hover:bg-muted"
          >
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-10 items-center justify-center rounded-full border border-[#465B94] bg-white/[0.08] text-white transition-colors hover:bg-white/20",
        className
      )}
    >
      {children}
    </button>
  )
}
