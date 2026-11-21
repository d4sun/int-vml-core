import type { VendorStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { VENDOR_STATUS_LABEL } from "@/lib/vendors/presentation"

const VARIANT: Record<VendorStatus, "navy" | "green" | "red" | "outline"> = {
  PENDING: "navy",
  APPROVED: "green",
  SUSPENDED: "red",
  REJECTED: "outline",
}

/** The label is always text, so status never relies on colour alone. */
export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  return (
    <Badge variant={VARIANT[status]} data-status={status}>
      {VENDOR_STATUS_LABEL[status]}
    </Badge>
  )
}
