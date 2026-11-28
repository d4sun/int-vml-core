"use server"

import { redirect } from "next/navigation"
import { checkout } from "@/lib/services/checkout"
import { startPayment } from "@/lib/services/payment"

/** Turns the cart into a pending booking and sends the visitor to the card page. */
export async function payCartAction(formData: FormData): Promise<void> {
  const holdIds = formData
    .getAll("holdId")
    .filter((v): v is string => typeof v === "string")

  let checkoutUrl: string

  try {
    const booked = await checkout({ holdIds })
    checkoutUrl = (await startPayment(booked.bookingId, 1)).checkoutUrl
  } catch {
    redirect("/cart?checkout=unavailable")
  }

  redirect(checkoutUrl)
}

/** Sends a visitor with a pending booking back to its card page. */
export async function continuePaymentAction(formData: FormData): Promise<void> {
  const bookingId = String(formData.get("bookingId") ?? "")

  let checkoutUrl: string

  try {
    checkoutUrl = (await startPayment(bookingId, 1)).checkoutUrl
  } catch {
    redirect(
      `/checkout/processing?booking=${encodeURIComponent(bookingId)}&error=1`
    )
  }

  redirect(checkoutUrl)
}
