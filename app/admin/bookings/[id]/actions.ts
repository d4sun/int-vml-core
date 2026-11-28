"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import { poundsToPence } from "@/lib/money/pounds"
import { issueRefund, type IssuedRefund } from "@/lib/services/refund-issue"
import { retryReversal } from "@/lib/services/refund-retry"
import type { SettlementOutcome } from "@/lib/services/refund-settlement"

export async function issueRefundAction(
  _previous: ActionState<IssuedRefund> | null,
  formData: FormData
): Promise<ActionState<IssuedRefund>> {
  const bookingId = formData.get("bookingId")
  const reason = formData.get("reason")
  const text = formData.get("amount")

  const result = await runAction(() =>
    issueRefund({
      bookingItemId: formData.get("bookingItemId"),
      amount: typeof text === "string" ? poundsToPence(text) : Number.NaN,
      ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
    })
  )

  if (result.status === "success" && typeof bookingId === "string") {
    revalidatePath(`/admin/bookings/${bookingId}`)
  }

  return result
}

export async function retryReversalAction(
  _previous: ActionState<SettlementOutcome> | null,
  formData: FormData
): Promise<ActionState<SettlementOutcome>> {
  const bookingId = formData.get("bookingId")
  const refundId = formData.get("refundId")

  const result = await runAction(() =>
    retryReversal(typeof refundId === "string" ? refundId : "")
  )

  if (typeof bookingId === "string") {
    revalidatePath(`/admin/bookings/${bookingId}`)
  }

  return result
}
