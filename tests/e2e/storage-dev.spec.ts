import { randomUUID } from "node:crypto"
import { expect, test } from "./support"

// The stand-in for the picture bucket (only present while storage is the
// in-memory fake, which is how every e2e run is configured).
test("the stand-in picture storage accepts allowed pictures, serves them back and refuses the rest", async ({
  request,
}) => {
  const key = `listings/e2e-${randomUUID()}/${randomUUID()}.png`
  const body = Buffer.from([137, 80, 78, 71, 1, 2, 3])

  const put = await request.put(`/api/dev/storage/${key}`, {
    data: body,
    headers: { "content-type": "image/png" },
  })

  expect(put.status()).toBe(200)

  const get = await request.get(`/api/dev/storage/${key}`)

  expect(get.status()).toBe(200)
  expect(get.headers()["content-type"]).toBe("image/png")
  expect(Buffer.from(await get.body()).equals(body)).toBe(true)

  const html = await request.put(`/api/dev/storage/${key}x`, {
    data: "<script>alert(1)</script>",
    headers: { "content-type": "text/html" },
  })

  expect(html.status()).toBe(415)

  const outside = await request.put("/api/dev/storage/elsewhere/a.png", {
    data: body,
    headers: { "content-type": "image/png" },
  })

  expect(outside.status()).toBe(415)
  expect(
    (await request.get("/api/dev/storage/listings/none/none.png")).status()
  ).toBe(404)
})
