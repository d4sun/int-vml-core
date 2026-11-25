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
export function findUngatedSellPaths(files: SourceFile[]): UngatedPath[] {
  const found: UngatedPath[] = []

  for (const file of files) {
    if (file.text.includes(GATE)) continue

    if (LISTING_WRITE.test(file.text) && PUBLISHED.test(file.text)) {
      found.push({ path: file.path, kind: "publish" })
    }

    if (PAYOUT.some((pattern) => pattern.test(file.text))) {
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
