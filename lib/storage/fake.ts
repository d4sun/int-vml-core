import type { ImageStorage, StoredObject, UploadTarget } from "./adapter"
import { UPLOAD_URL_TTL_SECONDS, type ImageContentType } from "./limits"

/** In-memory storage for tests and local development. */
export class FakeStorage implements ImageStorage {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >()
  readonly deleted: string[] = []

  constructor(
    private readonly options: { origin?: string; now?: () => Date } = {}
  ) {}

  async createUploadTarget(input: {
    key: string
    contentType: ImageContentType
  }): Promise<UploadTarget> {
    const now = (this.options.now ?? (() => new Date()))()
    const origin = this.options.origin ?? ""

    return {
      url: `${origin}/api/dev/storage/${input.key}`,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key)

    return object
      ? { size: object.bytes.byteLength, contentType: object.contentType }
      : null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
    this.deleted.push(key)
  }

  publicUrl(key: string): string {
    return `${this.options.origin ?? ""}/api/dev/storage/${key}`
  }

  // ---- what the dev route and tests do in place of the bucket ----------

  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType })
  }

  get(key: string) {
    return this.objects.get(key) ?? null
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }
}
