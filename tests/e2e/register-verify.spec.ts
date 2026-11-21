import {
  PASSWORD,
  expect,
  linkIn,
  test,
  uniqueEmail,
  waitForEmail,
} from "./support"

test("E2E-S1-01: register, receive the email, verify, and end up signed in", async ({
  page,
}) => {
  const email = uniqueEmail()

  await page.goto("/register")
  await page.getByLabel("Full name").fill("Ada Lovelace")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByText("we've sent a confirmation link")).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  const message = await waitForEmail(email, "verification")
  expect(message.subject.length).toBeGreaterThan(0)

  await page.goto(linkIn(message))

  await expect(page).toHaveURL(/\/verify-email\/complete$/)
  await expect(
    page.getByRole("heading", { name: "Email verified" })
  ).toBeVisible()

  // Verification signs the user in: a protected page opens without a login.
  await page.goto("/account/profile")
  await expect(
    page.getByRole("heading", { name: "Your profile" })
  ).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
})
