import type { ListingStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { LISTING_STATUS_LABEL } from "@/lib/listings/presentation"

const VARIANT: Record<ListingStatus, "navy" | "green" | "red" | "outline"> = {
  DRAFT: "outline",
  PENDING_REVIEW: "navy",
  PUBLISHED: "green",
  REJECTED: "red",
  ARCHIVED: "outline",
}

/** The label is always text, so status never relies on colour alone. */
export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return (
    <Badge variant={VARIANT[status]} data-status={status}>
      {LISTING_STATUS_LABEL[status]}
    </Badge>
  )
}
