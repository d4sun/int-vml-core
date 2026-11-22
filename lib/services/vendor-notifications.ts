import type { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  vendorApprovedEmail,
  vendorRejectedEmail,
  vendorReinstatedEmail,
  vendorSuspendedEmail,
  type VendorStatusEmailInput,
} from "@/lib/email/templates"
import type { TemplateContent } from "@/lib/email/templates"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"
import { deterministicUuid } from "@/lib/jobs/deterministic-id"
import { consoleJobLogger } from "@/lib/jobs/logger"
import type { VendorAction } from "@/lib/vendors/transitions"

export type Recipient = { email: string; name: string | null }

const TEMPLATES: Record<
  VendorAction,
  { kind: string; render: (input: VendorStatusEmailInput) => TemplateContent }
> = {
  approve: { kind: "vendor-approved", render: vendorApprovedEmail },
  reject: { kind: "vendor-rejected", render: vendorRejectedEmail },
  suspend: { kind: "vendor-suspended", render: vendorSuspendedEmail },
  reinstate: { kind: "vendor-reinstated", render: vendorReinstatedEmail },
}

/** The `tags.kind` an email for this action carries (also what tests look for). */
export function vendorEmailKind(action: VendorAction): string {
  return TEMPLATES[action].kind
}

/**
 * Who is told: the vendor's owner(s). A vendor with no owner (it should not
 * happen) falls back to its contact address, if that is a valid email. Staff
 * are not notified of governance decisions. Duplicates are removed.
 */
export function resolveRecipients(
  owners: Recipient[],
  contactEmail: string | null
): Recipient[] {
  const seen = new Set<string>()
  const recipients: Recipient[] = []

  for (const owner of owners) {
    const key = owner.email.toLowerCase()

    if (seen.has(key)) continue

    seen.add(key)
    recipients.push(owner)
  }

  if (recipients.length === 0 && contactEmail) {
    const parsed = z.email().safeParse(contactEmail.trim())

    if (parsed.success) recipients.push({ email: parsed.data, name: null })
  }

  return recipients
}

/**
 * One id per (transition, recipient): re-running the same notification, for
 * example after a retried request, cannot create a second job.
 */
export function emailJobId(auditId: string, email: string): string {
  return deterministicUuid(
    `vendor-status-email:${auditId}:${email.toLowerCase()}`
  )
}

export function buildVendorEmail(
  action: VendorAction,
  to: Recipient,
  input: { vendorName: string; reason?: string; appUrl: string }
): EmailMessage {
  const { subject, html, text } = TEMPLATES[action].render({
    name: to.name,
    vendorName: input.vendorName,
    ...(input.reason ? { reason: input.reason } : {}),
    dashboardUrl: `${input.appUrl.replace(/\/+$/, "")}/vendor`,
  })

  return {
    to: to.email,
    subject,
    html,
    text,
    tags: { kind: TEMPLATES[action].kind },
  }
}

export type VendorTransitionNotice = {
  action: VendorAction
  /** The audit row of this transition; it makes the email jobs idempotent. */
  auditId: string
  vendor: { id: string; name: string; contactEmail: string | null }
  reason?: string
  appUrl: string
}

/**
 * Enqueues exactly one email per recipient for a vendor status change, inside
 * the same transaction as the change. Returns how many jobs were created.
 * Having no recipient is logged, not fatal: the decision still stands.
 */
export async function notifyVendorTransition(
  tx: Pick<Prisma.TransactionClient, "vendorMember" | "$queryRawUnsafe">,
  queue: TransactionalEmailQueue,
  notice: VendorTransitionNotice
): Promise<number> {
  const owners = await tx.vendorMember.findMany({
    where: { vendorId: notice.vendor.id, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { name: true, email: true } } },
  })

  const recipients = resolveRecipients(
    owners.map((owner) => owner.user),
    notice.vendor.contactEmail
  )

  if (recipients.length === 0) {
    consoleJobLogger.error(
      "vendor status email not sent: no recipient",
      undefined,
      {
        vendorId: notice.vendor.id,
        action: notice.action,
      }
    )

    return 0
  }

  let created = 0

  for (const recipient of recipients) {
    const message = buildVendorEmail(notice.action, recipient, {
      vendorName: notice.vendor.name,
      appUrl: notice.appUrl,
      ...(notice.reason ? { reason: notice.reason } : {}),
    })

    if (
      await queue.enqueueInTransaction(
        tx,
        message,
        emailJobId(notice.auditId, recipient.email)
      )
    ) {
      created += 1
    }
  }

  return created
}
