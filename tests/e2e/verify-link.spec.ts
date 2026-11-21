import {
  signUpViaApi,
  expect,
  linkIn,
  test,
  uniqueEmail,
  waitForEmail,
} from "./support"

test("E2E-S1-03: a bad link explains itself and a resent link works", async ({
  page,
  request,
}) => {
  const email = uniqueEmail()

  await signUpViaApi(request, email)
  const first = await waitForEmail(email, "verification")

  // A tampered token lands on our page, with an error and a way forward.
  await page.goto(linkIn(first).replace(/token=[^&]+/, "token=garbage"))
  await expect(page).toHaveURL(/\/verify-email\/complete\?error=INVALID_TOKEN/)
  await expect(
    page.getByRole("heading", { name: "This link isn't valid" })
  ).toBeVisible()

  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Resend verification email" }).click()
  await expect(page.getByText("a new link is on its way")).toBeVisible()

  const second = await waitForEmail(email, "verification", 1)

  await page.goto(linkIn(second))
  await expect(
    page.getByRole("heading", { name: "Email verified" })
  ).toBeVisible()
})
