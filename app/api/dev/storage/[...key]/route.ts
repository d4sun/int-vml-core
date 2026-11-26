import { isImageContentType } from "@/lib/storage/limits"
import { getFakeStorage } from "@/lib/storage"

// Development only: the stand-in for the picture bucket. It exists only while
// the in-memory fake is the storage (never with S3), accepts pictures of the
// allowed types up to the size limit, and serves them back.
const notFound = () => new Response(null, { status: 404 })

const keyOf = async (params: Promise<{ key: string[] }>) =>
  (await params).key.join("/")

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const storage = getFakeStorage()

  if (!storage) return notFound()

  const key = await keyOf(params)
  const contentType = request.headers.get("content-type") ?? ""

  if (!key.startsWith("listings/") || !isImageContentType(contentType)) {
    return new Response("Unsupported", { status: 415 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())

  // No size cap here on purpose: a bucket would store it too, so the
  // service's check after the upload is what rejects an oversize file.
  storage.put(key, bytes, contentType)

  return new Response(null, { status: 200 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const storage = getFakeStorage()

  if (!storage) return notFound()

  const object = storage.get(await keyOf(params))

  if (!object) return notFound()

  return new Response(Buffer.from(object.bytes), {
    headers: {
      "content-type": object.contentType,
      "cache-control": "no-store",
    },
  })
}
