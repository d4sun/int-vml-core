import type { ListingStatus } from "@prisma/client"

/**
 * What a vendor can do to a listing, and where it leads. Publishing is not
 * here: only an admin moves a listing to PUBLISHED (E9-S1), so no vendor
 * action can ever make a listing public.
 *
 * - `submit`: DRAFT or REJECTED goes to review.
 * - `majorEdit`: a PUBLISHED listing whose core details change goes back to
 *   review, so what is public is always what an admin approved.
 */
export type VendorListingEvent = "submit" | "majorEdit"

export const VENDOR_LISTING_EVENTS: readonly VendorListingEvent[] = [
  "submit",
  "majorEdit",
]

const NEXT: Record<
  VendorListingEvent,
  Partial<Record<ListingStatus, ListingStatus>>
> = {
  submit: { DRAFT: "PENDING_REVIEW", REJECTED: "PENDING_REVIEW" },
  majorEdit: { PUBLISHED: "PENDING_REVIEW" },
}

/** The status an event leads to, or `null` when it does not apply. */
export function nextListingStatus(
  current: ListingStatus,
  event: VendorListingEvent
): ListingStatus | null {
  return NEXT[event][current] ?? null
}

/**
 * Statuses a vendor may edit in. A listing under review is frozen so the
 * admin approves exactly what they were shown; an archived one is closed.
 */
const EDITABLE: readonly ListingStatus[] = ["DRAFT", "REJECTED", "PUBLISHED"]

export function canVendorEdit(status: ListingStatus): boolean {
  return EDITABLE.includes(status)
}

/**
 * Fields that change what a tourist sees or books, so changing one on a
 * PUBLISHED listing needs a fresh review. `images` stands for **adding** a
 * picture (it is the thing most in need of moderation); removing or
 * reordering pictures cannot show anything new and needs no review.
 */
export const MAJOR_FIELDS = [
  "title",
  "description",
  "categoryId",
  "address",
  "lat",
  "lng",
  "images",
] as const

export type MajorField = (typeof MAJOR_FIELDS)[number]

export function isMajorEdit(changedFields: readonly string[]): boolean {
  return changedFields.some((field) =>
    (MAJOR_FIELDS as readonly string[]).includes(field)
  )
}
