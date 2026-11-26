"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import {
  IMAGE_TYPES,
  MAX_IMAGES_PER_LISTING,
  MAX_IMAGE_BYTES,
} from "@/lib/storage/limits"

export type GalleryImage = { id: string; url: string }

type Actions = {
  request: (input: {
    listingId: string
    contentType: string
    size: number
  }) => Promise<
    ActionState<{ key: string; url: string; headers: Record<string, string> }>
  >
  confirm: (input: {
    listingId: string
    key: string
  }) => Promise<ActionState<{ id: string }>>
  remove: (input: {
    listingId: string
    imageId: string
  }) => Promise<ActionState<{ id: string }>>
  reorder: (input: {
    listingId: string
    imageIds: string[]
  }) => Promise<ActionState<{ count: number }>>
}

const ACCEPT = Object.keys(IMAGE_TYPES).join(",")

/**
 * Uploads straight to storage with the target the server signed, then asks
 * the server to confirm. All checks that matter happen on the server; the
 * ones here (type and size) only save a round trip.
 */
export function ImageUploader({
  listingId,
  images,
  editable,
  actions,
}: {
  listingId: string
  images: GalleryImage[]
  editable: boolean
  actions: Actions
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const fail = (text: string) => setMessage(text)

  async function upload(file: File) {
    if (!Object.hasOwn(IMAGE_TYPES, file.type)) {
      return fail(`${file.name}: upload a JPEG, PNG or WebP picture.`)
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return fail(`${file.name}: pictures can be at most 5 MB.`)
    }

    const target = await actions.request({
      listingId,
      contentType: file.type,
      size: file.size,
    })

    if (target.status === "error") return fail(target.message)

    const put = await fetch(target.data.url, {
      method: "PUT",
      headers: target.data.headers,
      body: file,
    })

    if (!put.ok)
      return fail(`${file.name}: the upload failed. Please try again.`)

    const confirmed = await actions.confirm({ listingId, key: target.data.key })

    if (confirmed.status === "error") return fail(confirmed.message)
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    setBusy(true)
    setMessage(null)

    for (const file of Array.from(files)) {
      await upload(file)
    }

    if (input.current) input.current.value = ""
    setBusy(false)
    router.refresh()
  }

  async function run(work: Promise<ActionState<unknown>>) {
    setBusy(true)
    setMessage(null)

    const result = await work

    if (result.status === "error") fail(result.message)

    setBusy(false)
    router.refresh()
  }

  const move = (index: number, by: -1 | 1) => {
    const ids = images.map((i) => i.id)
    const target = index + by

    if (target < 0 || target >= ids.length) return

    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    void run(actions.reorder({ listingId, imageIds: ids }))
  }

  return (
    <section aria-labelledby="pictures-heading" className="space-y-4">
      <h2 id="pictures-heading" className="text-lg font-semibold text-vml-ink">
        Pictures
      </h2>
      <p className="text-sm text-muted-foreground">
        JPEG, PNG or WebP, up to 5 MB each, at most {MAX_IMAGES_PER_LISTING}.
        The first picture is the cover.
      </p>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pictures yet.</p>
      ) : (
        <ul
          data-testid="gallery"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3"
        >
          {images.map((image, index) => (
            <li
              key={image.id}
              data-testid="gallery-item"
              data-image-id={image.id}
              className="space-y-2 rounded-xl border p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Picture ${index + 1}${index === 0 ? " (cover)" : ""}`}
                className="aspect-video w-full rounded-lg object-cover"
              />
              {editable ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move picture ${index + 1} earlier`}
                  >
                    ←
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || index === images.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move picture ${index + 1} later`}
                  >
                    →
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(actions.remove({ listingId, imageId: image.id }))
                    }
                    aria-label={`Remove picture ${index + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable && images.length < MAX_IMAGES_PER_LISTING ? (
        <div className="space-y-2">
          <label
            htmlFor="picture-file"
            className="text-sm font-medium text-vml-ink"
          >
            Add pictures
          </label>
          <input
            ref={input}
            id="picture-file"
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            onChange={(event) => void onFiles(event.target.files)}
            className="block text-sm"
          />
        </div>
      ) : null}

      {busy ? (
        <p role="status" className="text-sm">
          Working…
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {message}
        </p>
      ) : null}
    </section>
  )
}
