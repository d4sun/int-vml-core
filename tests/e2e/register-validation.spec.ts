import {
  PASSWORD,
  countEmails,
  expect,
  test,
  uniqueEmail,
  waitForEmail,
} from "./support"

test("E2E-S1-02: invalid input is explained, and a duplicate address looks identical to a new one", async ({
  page,
}) => {
  await page.goto("/register")

  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("Enter your name")).toBeVisible()
  await expect(page.getByText("Enter a valid email address")).toBeVisible()
  await expect(page.getByText(/Password must be at least 8/)).toBeVisible()

  await page.getByLabel("Full name").fill("Ada")
  await page.getByLabel("Email").fill(uniqueEmail())
  await page.getByLabel("Password").fill("alllettersnodigit")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText(/at least one number/)).toBeVisible()

  // Register once for real, then again with the same address.
  const email = uniqueEmail()
  const register = async () => {
    await page.goto("/register")
    await page.getByLabel("Full name").fill("Ada")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()

    return page.getByText("we've sent a confirmation link").textContent()
  }

  const first = await register()
  await waitForEmail(email, "verification")
  const second = await register()

  expect(second).toBe(first)
  // No account enumeration, and no second email to the existing user.
  expect(await countEmails(email, "verification")).toBe(1)
})
