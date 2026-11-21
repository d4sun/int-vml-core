import {
  SEED,
  SEED_PASSWORD,
  expect,
  expectSignInRedirect,
  signInAndWait,
  signInViaUi,
  test,
} from "./support"

const NOT_FOUND = "This page could not be found."

test("E2E-07: signed-out visitors are sent to sign-in and see no restricted content", async ({
  page,
}) => {
  for (const area of ["/vendor", "/admin"]) {
    await page.goto(area)

    await expectSignInRedirect(page, area)
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(page.getByText(/dashboard/i)).toHaveCount(0)
  }
})

test("E2E-07: a tourist is denied both areas with no data and no hint", async ({
  page,
}) => {
  await signInViaUi(page, SEED.tourist, SEED_PASSWORD)
  await expect(page).toHaveURL(/\/$/)

  for (const area of ["/vendor", "/admin"]) {
    const response = await page.goto(area)

    expect(response?.status()).toBe(404)
    await expect(page.getByText(NOT_FOUND)).toBeVisible()
    await expect(page.getByText(/dashboard/i)).toHaveCount(0)
  }
})

test("E2E-07: each role reaches only its own area", async ({ page }) => {
  await signInAndWait(page, SEED.owner, SEED_PASSWORD)
  await page.goto("/vendor")
  await expect(
    page.getByRole("heading", { name: "Vendor dashboard" })
  ).toBeVisible()
  expect((await page.goto("/admin"))?.status()).toBe(404)

  await page.context().clearCookies()

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin")
  await expect(
    page.getByRole("heading", { name: "Admin dashboard" })
  ).toBeVisible()
  expect((await page.goto("/vendor"))?.status()).toBe(404)
})
