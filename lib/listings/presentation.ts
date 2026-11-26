import type { ListingStatus } from "@prisma/client"

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
}

/** Why the vendor sees what they see, in plain words. */
export const LISTING_STATUS_HELP: Record<ListingStatus, string> = {
  DRAFT: "Only you can see this. Submit it when it is ready for review.",
  PENDING_REVIEW:
    "We're reviewing this listing. It can't be edited until we've decided.",
  PUBLISHED:
    "Live on the site. Changing the title, description, category, location or adding a picture sends it back for review.",
  REJECTED: "This listing wasn't approved. Fix it and submit it again.",
  ARCHIVED: "This listing is closed.",
}
