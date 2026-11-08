import type { Metadata } from "next"
import { Geist, Geist_Mono, Urbanist } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { SiteHeader } from "@/components/brand/site-header"
import { SiteFooter } from "@/components/brand/site-footer"
import { cn } from "@/lib/utils"

// Geist for body/UI copy; Urbanist for display headings, nav and the hero
// wordmark (per the design spec). Both exposed as CSS variables.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-heading",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "Visit My London — Plan and book everything London from one place",
    template: "%s · Visit My London",
  },
  description:
    "London's independent travel guide. Discover attractions, tours, events, food, stays and more — and book it all in one place.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable, urbanist.variable)}
    >
      <body className="min-h-svh bg-background">
        <ThemeProvider>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  )
}
