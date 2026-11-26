import { createHash, createHmac } from "node:crypto"

/**
 * AWS Signature Version 4 for presigned (query-string) S3 URLs, without the
 * SDK. Verified against the worked example in AWS's documentation (see
 * `tests/unit/storage-sigv4.test.ts`).
 */
export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE"
  /** `bucket.s3.eu-west-2.amazonaws.com` or an S3-compatible host. */
  host: string
  /** Absolute path, already URI-encoded per segment. */
  path: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  now: Date
  expiresSeconds: number
  /** Extra headers that are signed, so the client must send them unchanged. */
  headers?: Record<string, string>
  protocol?: "https" | "http"
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex")
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest()

/** RFC 3986 encoding, as SigV4 requires (`encodeURIComponent` leaves `!'()*`). */
export const uriEncode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )

export const encodeKeyPath = (path: string) =>
  path.split("/").map(uriEncode).join("/")

const amzDate = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")

export function presignUrl(input: PresignInput): string {
  const stamp = amzDate(input.now)
  const day = stamp.slice(0, 8)
  const scope = `${day}/${input.region}/s3/aws4_request`

  const headers: Record<string, string> = {
    host: input.host,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    ),
  }
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(";")

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k]!)}`)
    .join("&")

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n")

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256(canonicalRequest),
  ].join("\n")

  const signingKey = [day, input.region, "s3", "aws4_request"].reduce<
    Buffer | string
  >((key, part) => hmac(key, part), `AWS4${input.secretAccessKey}`)
  const signature = createHmac("sha256", signingKey as Buffer)
    .update(stringToSign)
    .digest("hex")

  return `${input.protocol ?? "https"}://${input.host}${input.path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
