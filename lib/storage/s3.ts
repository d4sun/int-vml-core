import type { ImageStorage, StoredObject, UploadTarget } from "./adapter"
import { UPLOAD_URL_TTL_SECONDS, type ImageContentType } from "./limits"
import { encodeKeyPath, presignUrl } from "./sigv4"

export type S3Options = {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** An S3-compatible service (path-style); omit for AWS. */
  endpoint?: string
  /** The origin pictures are served from, e.g. a CDN or the public bucket. */
  publicBaseUrl: string
  now?: () => Date
  fetch?: typeof fetch
}

/**
 * S3 through presigned URLs: the browser uploads straight to the bucket, and
 * the server only signs, inspects (`HEAD`) and deletes. No SDK, so nothing
 * here needs the network until a request is made.
 */
export class S3Storage implements ImageStorage {
  private readonly now: () => Date
  private readonly doFetch: typeof fetch

  constructor(private readonly options: S3Options) {
    this.now = options.now ?? (() => new Date())
    this.doFetch = options.fetch ?? fetch
  }

  private target(key: string) {
    const { bucket, region, endpoint } = this.options

    if (endpoint) {
      const url = new URL(endpoint)

      return {
        host: url.host,
        path: `/${encodeKeyPath(`${bucket}/${key}`)}`,
        protocol:
          url.protocol === "http:" ? ("http" as const) : ("https" as const),
      }
    }

    return {
      host: `${bucket}.s3.${region}.amazonaws.com`,
      path: `/${encodeKeyPath(key)}`,
      protocol: "https" as const,
    }
  }

  private sign(
    method: "PUT" | "HEAD" | "DELETE",
    key: string,
    headers?: Record<string, string>
  ) {
    const { region, accessKeyId, secretAccessKey } = this.options

    return presignUrl({
      method,
      ...this.target(key),
      region,
      accessKeyId,
      secretAccessKey,
      now: this.now(),
      expiresSeconds: UPLOAD_URL_TTL_SECONDS,
      ...(headers ? { headers } : {}),
    })
  }

  async createUploadTarget(input: {
    key: string
    contentType: ImageContentType
  }): Promise<UploadTarget> {
    const headers = { "content-type": input.contentType }

    return {
      url: this.sign("PUT", input.key, headers),
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(this.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await this.doFetch(this.sign("HEAD", key), {
      method: "HEAD",
    })

    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Storage HEAD failed: ${response.status}`)

    return {
      size: Number(response.headers.get("content-length") ?? 0),
      contentType: response.headers.get("content-type") ?? "",
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.doFetch(this.sign("DELETE", key), {
      method: "DELETE",
    })

    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage DELETE failed: ${response.status}`)
    }
  }

  publicUrl(key: string): string {
    return `${this.options.publicBaseUrl.replace(/\/+$/, "")}/${encodeKeyPath(key)}`
  }
}
