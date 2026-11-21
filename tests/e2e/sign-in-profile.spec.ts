import {
  createVerifiedUser,
  expect,
  expectSignInRedirect,
  signInViaUi,
  test,
} from "./support"

test("E2E-S2-01: sign in, edit the profile, sign out", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request, "Original Name")

  await signInViaUi(page, email, password, "/account/profile")

  await expect(page).toHaveURL(/\/account\/profile$/)
  await expect(page.getByLabel("Full name")).toHaveValue("Original Name")

  await page.getByLabel("Full name").fill("  New Name  ")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Profile updated.")).toBeVisible()

  await page.reload()
  await expect(page.getByLabel("Full name")).toHaveValue("New Name")

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/$/)

  // The session is really gone: the protected page sends us back to sign-in.
  await page.goto("/account/profile")
  await expectSignInRedirect(page, "/account/profile")
})
