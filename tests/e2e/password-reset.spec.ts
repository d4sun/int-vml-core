import {
  createVerifiedUser,
  expect,
  linkIn,
  test,
  waitForEmail,
} from "./support"

test("E2E-S2-03: forgot, reset with a single-use link, then sign in with the new password", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const newPassword = "brand-new-pass-9"

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByText("If an account exists for")).toBeVisible()

  const link = linkIn(await waitForEmail(email, "password-reset"))

  await page.goto(link)
  await expect(page).toHaveURL(/\/reset-password\?token=/)

  await page.getByLabel("New password", { exact: true }).fill(newPassword)
  await page.getByLabel("Confirm new password").fill("something-else-1")
  await page.getByRole("button", { name: "Update password" }).click()
  await expect(page.getByText("Passwords do not match")).toBeVisible()

  await page.getByLabel("Confirm new password").fill(newPassword)
  await page.getByRole("button", { name: "Update password" }).click()
  await expect(page.getByText("Your password has been updated")).toBeVisible()

  // The link is single-use.
  await page.goto(link)
  await expect(
    page.getByRole("heading", { name: "This link isn't valid" })
  ).toBeVisible()

  // New password works, old one does not.
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByText("Incorrect email or password.")).toBeVisible()

  await page.getByLabel("Password").fill(newPassword)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/$/)
})
