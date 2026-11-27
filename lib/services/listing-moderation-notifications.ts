import type { Prisma } from "@prisma/client"
import {
  listingApprovedEmail,
  listingRejectedEmail,
  type ListingModerationEmailInput,
  type TemplateContent,
} from "@/lib/email/templates"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"
import { deterministicUuid } from "@/lib/jobs/deterministic-id"
import { consoleJobLogger } from "@/lib/jobs/logger"
import {
  resolveRecipients,
  type Recipient,
} from "@/lib/services/vendor-notifications"
import type { ModerationAction } from "@/lib/listings/moderation"

const TEMPLATES: Record<
  ModerationAction,
  {
    kind: string
    render: (input: ListingModerationEmailInput) => TemplateContent
  }
> = {
  approve: { kind: "listing-approved", render: listingApprovedEmail },
  reject: { kind: "listing-rejected", render: listingRejectedEmail },
}

/** The `tags.kind` an email for this moderation action carries. */
export function listingEmailKind(action: ModerationAction): string {
  return TEMPLATES[action].kind
}

/**
 * One id per (decision, recipient), so repeating the same decision cannot
 * send a second email.
 */
export function listingEmailJobId(auditId: string, email: string): string {
  return deterministicUuid(
    `listing-moderation-email:${auditId}:${email.toLowerCase()}`
  )
}

export function buildListingEmail(
  action: ModerationAction,
  to: Recipient,
  input: { listingTitle: string; reason?: string; appUrl: string }
): EmailMessage {
  const { subject, html, text } = TEMPLATES[action].render({
    name: to.name,
    listingTitle: input.listingTitle,
    ...(input.reason ? { reason: input.reason } : {}),
    listingsUrl: `${input.appUrl.replace(/\/+$/, "")}/vendor/listings`,
  })

  return {
    to: to.email,
    subject,
    html,
    text,
    tags: { kind: TEMPLATES[action].kind },
  }
}

export type ListingModerationNotice = {
  action: ModerationAction
  /** The audit row of the decision; it makes the email jobs idempotent. */
  auditId: string
  listing: { id: string; title: string; vendorId: string }
  reason?: string
  appUrl: string
}

/**
 * Enqueues one email per vendor owner for a moderation decision, inside the
 * same transaction as the decision. A listing that has no owner to tell is
 * logged, not fatal: the decision still stands.
 */
export async function notifyListingModeration(
  tx: Pick<Prisma.TransactionClient, "vendorMember" | "$queryRawUnsafe">,
  queue: TransactionalEmailQueue,
  notice: ListingModerationNotice
): Promise<number> {
  const owners = await tx.vendorMember.findMany({
    where: { vendorId: notice.listing.vendorId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { name: true, email: true } } },
  })

  const recipients = resolveRecipients(
    owners.map((owner) => owner.user),
    null
  )

  if (recipients.length === 0) {
    consoleJobLogger.error("listing email not sent: no owner", undefined, {
      listingId: notice.listing.id,
      action: notice.action,
    })

    return 0
  }

  let created = 0

  for (const recipient of recipients) {
    const message = buildListingEmail(notice.action, recipient, {
      listingTitle: notice.listing.title,
      appUrl: notice.appUrl,
      ...(notice.reason ? { reason: notice.reason } : {}),
    })

    if (
      await queue.enqueueInTransaction(
        tx,
        message,
        listingEmailJobId(notice.auditId, recipient.email)
      )
    ) {
      created += 1
    }
  }

  return created
}
