import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/guards"
import { prisma } from "@/lib/prisma"
import { AppError } from "@/lib/errors"

/**
 * The visitor's own booking, as the processing page polls it. It reads state;
 * it never changes it (CR-4: only the webhook confirms a payment).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const user = await requireUser()
    const booking = await prisma.booking.findFirst({
      where: { id, touristUserId: user.id },
      select: { status: true },
    })

    if (!booking)
      return NextResponse.json({ error: "not_found" }, { status: 404 })

    return NextResponse.json(
      { status: booking.status },
      { headers: { "cache-control": "no-store" } }
    )
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
    }

    throw error
  }
}
