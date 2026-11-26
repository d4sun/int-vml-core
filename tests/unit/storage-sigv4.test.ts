import { describe, expect, it } from "vitest"
import { encodeKeyPath, presignUrl, uriEncode } from "@/lib/storage/sigv4"

// The worked example from AWS's documentation, "Authenticating Requests:
// Using Query Parameters (AWS Signature Version 4)". The published signature
// is the proof that this implementation signs the way S3 verifies.
const AWS_EXAMPLE = {
  method: "GET" as const,
  host: "examplebucket.s3.amazonaws.com",
  path: "/test.txt",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  now: new Date("2013-05-24T00:00:00Z"),
  expiresSeconds: 86_400,
}

describe("presignUrl", () => {
  it("reproduces the signature AWS publishes for its own example", () => {
    const url = new URL(presignUrl(AWS_EXAMPLE))

    expect(url.host).toBe("examplebucket.s3.amazonaws.com")
    expect(url.pathname).toBe("/test.txt")
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request"
    )
    expect(url.searchParams.get("X-Amz-Date")).toBe("20130524T000000Z")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("86400")
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host")
  })

  it("the signature depends on every part of the request", () => {
    const base = new URL(presignUrl(AWS_EXAMPLE)).searchParams.get(
      "X-Amz-Signature"
    )

    for (const change of [
      { method: "PUT" as const },
      { path: "/other.txt" },
      { region: "eu-west-2" },
      { secretAccessKey: "different" },
      { now: new Date("2013-05-24T00:00:01Z") },
      { expiresSeconds: 60 },
      { headers: { "content-type": "image/png" } },
      { host: "other.s3.amazonaws.com" },
    ]) {
      const signature = new URL(
        presignUrl({ ...AWS_EXAMPLE, ...change })
      ).searchParams.get("X-Amz-Signature")

      expect(signature, JSON.stringify(change)).not.toBe(base)
    }
  })

  it("signs extra headers, in sorted order, lower-cased", () => {
    const url = new URL(
      presignUrl({
        ...AWS_EXAMPLE,
        method: "PUT",
        headers: { "Content-Type": "image/png" },
      })
    )

    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host"
    )
  })
})

describe("uriEncode", () => {
  it("encodes what SigV4 requires, including the characters encodeURIComponent keeps", () => {
    expect(uriEncode("a b/c")).toBe("a%20b%2Fc")
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A")
    expect(uriEncode("AZaz09-_.~")).toBe("AZaz09-_.~")
  })

  it("keeps the slashes of an object key", () => {
    expect(encodeKeyPath("listings/a b/c.png")).toBe("listings/a%20b/c.png")
  })
})
