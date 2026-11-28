import type { Prisma } from "@prisma/client"

/**
 * Gives a booking item's places back to its time slot (E10-S1-05, CR-3).
 *
 * Runs inside the caller's transaction, so the places come back in the same
 * write that marks the item REFUNDED: a retry or a duplicate event cannot give
 * them back twice, because the item is only moved to REFUNDED once. The slot
 * is locked as the hold and release code locks it.
 *
 * A slot that would end up with more places than its capacity is an error,
 * not a silent clamp: it means the counts disagree, and the transaction fails
 * so the event is retried and the problem is seen.
 */
export async function restockItem(
  tx: Prisma.TransactionClient,
  bookingItemId: string
): Promise<void> {
  const item = await tx.bookingItem.findUniqueOrThrow({
    where: { id: bookingItemId },
    select: { availabilityId: true, quantity: true },
  })

  await tx.$queryRaw`SELECT 1 FROM "Availability" WHERE "id" = ${item.availabilityId} FOR UPDATE`

  const slot = await tx.availability.findUniqueOrThrow({
    where: { id: item.availabilityId },
    select: { capacity: true, remaining: true },
  })

  const next = slot.remaining + item.quantity

  if (next > slot.capacity) {
    throw new Error(
      `restock would take availability ${item.availabilityId} past its capacity`
    )
  }

  await tx.availability.update({
    where: { id: item.availabilityId },
    data: { remaining: next },
  })
}
