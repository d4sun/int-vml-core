import {
  SEED,
  SEED_PASSWORD,
  expect,
  expectSignInRedirect,
  signInViaUi,
  test,
} from "./support"

test("E2E-S2-04: sign-in returns you to where you were headed", async ({
  page,
}) => {
  await page.goto("/account/profile")
  await expectSignInRedirect(page, "/account/profile")

  await page.getByLabel("Email").fill(SEED.tourist)
  await page.getByLabel("Password").fill(SEED_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/account\/profile$/)
  await expect(
    page.getByRole("heading", { name: "Your profile" })
  ).toBeVisible()

  await page.context().clearCookies()

  await page.goto("/vendor")
  await page.getByLabel("Email").fill(SEED.owner)
  await page.getByLabel("Password").fill(SEED_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/vendor$/)
  await expect(
    page.getByRole("heading", { name: "Vendor dashboard" })
  ).toBeVisible()
})

test("E2E-S2-05: a ?next that leaves the site is ignored", async ({ page }) => {
  for (const next of [
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
  ]) {
    await page.context().clearCookies()
    await signInViaUi(page, SEED.tourist, SEED_PASSWORD, next)

    await expect(page).toHaveURL(/localhost:\d+\/$/)
  }
})
