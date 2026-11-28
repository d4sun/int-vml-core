import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export type SourceFile = { path: string; text: string }

export type UngatedPath = { path: string; kind: "publish" | "payout" }

const GATE = "assertVendorCanSell"

/**
 * Writing a listing in a module that assigns `status: "PUBLISHED"`: a publish
 * path. Comparing against PUBLISHED (`status === "PUBLISHED"`) is not a write.
 */
const LISTING_WRITE =
  /\blisting\.(update|updateMany|create|createMany|upsert)\s*\(/
const PUBLISHED = /\bstatus:\s*["']PUBLISHED["']/

/** Creating a transfer row or a Stripe transfer: a payout path. */
const PAYOUT = [
  /\btransfer\.(create|createMany|upsert)\s*\(/,
  /\btransfers\.create\s*\(/,
  /\bcreateTransfer\s*\(/,
]

/**
 * A tripwire, not a proof: every module that looks like it publishes a
 * listing or pays a vendor must mention `assertVendorCanSell`. It exists so a
 * future story cannot add either path and forget the gate (CR-4: hard-gated
 * server-side). Reads of PUBLISHED listings are not writes and do not match.
 */
/**
 * Payout-shaped code that is allowed without the gate in its own file, with the
 * reason. Each one sends no money itself: the Stripe adapter is the transport
 * that the settlement service calls (and gates); the payment handler only
 * records pending transfer rows, which settlement sends after the gate.
 */
export const PAYOUT_EXEMPT: Readonly<Record<string, string>> = {
  "lib/stripe/adapter.ts": "transport interface; callers are gated",
  "lib/stripe/real.ts": "transport: the SDK call; callers are gated",
  "lib/stripe/fake.ts": "transport: the test double; callers are gated",
  "lib/webhooks/payment-succeeded.ts":
    "records pending transfers only; settlement is gated",
}

export function findUngatedSellPaths(files: SourceFile[]): UngatedPath[] {
  const found: UngatedPath[] = []

  for (const file of files) {
    if (file.text.includes(GATE)) continue

    if (LISTING_WRITE.test(file.text) && PUBLISHED.test(file.text)) {
      found.push({ path: file.path, kind: "publish" })
    }

    if (
      !(file.path in PAYOUT_EXEMPT) &&
      PAYOUT.some((pattern) => pattern.test(file.text))
    ) {
      found.push({ path: file.path, kind: "payout" })
    }
  }

  return found
}

export function readSourceFiles(root: string, dirs: string[]): SourceFile[] {
  const files: SourceFile[] = []

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)

      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(name)) {
        files.push({
          path: relative(root, full),
          text: readFileSync(full, "utf8"),
        })
      }
    }
  }

  for (const dir of dirs) walk(join(root, dir))

  return files
}
