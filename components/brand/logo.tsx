import Link from "next/link"
import Image from "next/image"
import { cn } from "cn"

/**
 * Site logo. Renders the brand asset at `public/logo.png` (the full lockup —
 * no separate text wordmark). `tone` is accepted for API compatibility with
 * existing callers (header passes "light"); the image carries its own colour.
 */
export function Logo({
  className,
  tone = "light",
}: {
  className?: string
  tone?: "light" | "dark"
}) {
  void tone
  return (
    <Link href="/" className={cn("inline-flex items-center", className)} aria-label="Visit My London — home">
      <Image
        src="/logo.png"
        alt="Visit My London"
        width={1158}
        height={407}
        priority
        className="h-10 w-auto"
      />
    </Link>
  )
}
