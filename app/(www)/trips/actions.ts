"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  addTripItem,
  createTrip,
  deleteTrip,
  getTrip,
  removeTripItem,
  renameTrip,
  reorderTripItems,
  type TripRecord,
} from "@/lib/services/trip"

const text = (formData: FormData, name: string) => {
  const value = formData.get(name)

  return typeof value === "string" ? value : undefined
}

export async function createTripAction(
  _previous: ActionState<TripRecord> | null,
  formData: FormData
): Promise<ActionState<TripRecord>> {
  const result = await runAction(() =>
    createTrip({ name: text(formData, "name") })
  )

  if (result.status === "success") revalidatePath("/trips")

  return result
}

export async function renameTripAction(
  _previous: ActionState<TripRecord> | null,
  formData: FormData
): Promise<ActionState<TripRecord>> {
  const result = await runAction(() =>
    renameTrip({
      tripId: text(formData, "tripId"),
      name: text(formData, "name"),
    })
  )

  if (result.status === "success") {
    revalidatePath("/trips")
    revalidatePath(`/trips/${result.data.id}`)
  }

  return result
}

/** Adds a listing to a trip from a listing page. Returns the trip so the page can say so. */
export async function saveToTripAction(
  _previous: ActionState<TripRecord> | null,
  formData: FormData
): Promise<ActionState<TripRecord>> {
  const result = await runAction(() =>
    addTripItem({
      tripId: text(formData, "tripId"),
      listingId: text(formData, "listingId"),
      plannedDate: text(formData, "plannedDate") ?? "",
      note: text(formData, "note") ?? "",
    })
  )

  if (result.status === "success") revalidatePath(`/trips/${result.data.id}`)

  return result
}

export async function removeTripItemFormAction(
  formData: FormData
): Promise<void> {
  const tripId = text(formData, "tripId")

  await runAction(() => removeTripItem({ itemId: text(formData, "itemId") }))
  revalidatePath(`/trips/${tripId}`)
}

/** Moves one item up or down by swapping it with its neighbour; the whole order is then saved at once. */
export async function moveTripItemFormAction(
  formData: FormData
): Promise<void> {
  const tripId = text(formData, "tripId") ?? ""
  const itemId = text(formData, "itemId")
  const direction = text(formData, "direction")

  const trip = await getTrip(tripId)
  const ids = trip.items.map((item) => item.id)
  const at = ids.indexOf(itemId ?? "")
  const to = direction === "up" ? at - 1 : at + 1

  if (at >= 0 && to >= 0 && to < ids.length) {
    const next = [...ids]
    ;[next[at], next[to]] = [next[to]!, next[at]!]
    await runAction(() => reorderTripItems({ tripId, itemIds: next }))
  }

  revalidatePath(`/trips/${tripId}`)
}

export async function deleteTripFormAction(formData: FormData): Promise<void> {
  await runAction(() => deleteTrip({ tripId: text(formData, "tripId") }))
  revalidatePath("/trips")
  redirect("/trips")
}
