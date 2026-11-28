import type { PrismaClient } from "@prisma/client"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"

export type AdminDispute = {
  id: string
  stripeDisputeId: string
  amount: number
  reason: string | null
  status: string
  bookingId: string
  createdAt: Date
  updatedAt: Date
}

export type DisputesDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "dispute">
}

/** Every recorded dispute, newest first, for admins (E10-S2-03). Read only. */
export async function listDisputes(
  deps: DisputesDeps = {}
): Promise<AdminDispute[]> {
  await requireAdmin(deps.session)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const rows = await db.dispute.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      stripeDisputeId: true,
      amount: true,
      reason: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      payment: { select: { bookingId: true } },
    },
  })

  return rows.map(({ payment, ...row }) => ({
    ...row,
    bookingId: payment.bookingId,
  }))
}
