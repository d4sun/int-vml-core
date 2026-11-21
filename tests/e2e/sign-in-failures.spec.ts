import {
  PASSWORD,
  expect,
  signInViaUi,
  test,
  uniqueEmail,
  waitForEmail,
  createVerifiedUser,
  signUpViaApi,
} from "./support"

test("E2E-S2-02: failures are generic, unverified users can resend, and the IP is throttled", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)

  // Wrong password and unknown address read exactly the same.
  await signInViaUi(page, email, "wrong-password-1")
  await expect(page.getByText("Incorrect email or password.")).toBeVisible()
  await signInViaUi(page, uniqueEmail("ghost"), "wrong-password-1")
  await expect(page.getByText("Incorrect email or password.")).toBeVisible()

  // A correct password on an unverified account says so and offers a resend.
  const unverified = uniqueEmail()
  await signUpViaApi(request, unverified)
  await waitForEmail(unverified, "verification")

  await signInViaUi(page, unverified, PASSWORD)
  await expect(page.getByText("hasn't been verified yet")).toBeVisible()
  await page.getByRole("button", { name: "Resend verification email" }).click()
  await expect(page.getByText("a new link is on its way")).toBeVisible()

  // Ten failed attempts from one IP (three already used above), then throttled.
  for (let i = 0; i < 7; i += 1) {
    await request.post("/api/auth/sign-in/email", {
      data: { email: uniqueEmail("ghost"), password: "wrong-password-1" },
    })
  }

  await signInViaUi(page, uniqueEmail("ghost"), "wrong-password-1")
  await expect(page.getByText(/Too many attempts/)).toBeVisible()
})
