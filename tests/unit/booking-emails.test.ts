import { describe, expect, it } from "vitest"
import { bookingConfirmedEmail, newBookingEmail } from "@/lib/email/templates"

const line = {
  title: "Thames Walk: Morning",
  when: "1 Jun 2030, 10:00",
  places: 2,
}

describe("booking emails", () => {
  it("the confirmation carries the reference, the total and each line", () => {
    const m = bookingConfirmedEmail({
      name: "Olive",
      bookingRef: "AB12CD34",
      total: "£25.00",
      lines: [line],
      bookingsUrl: "https://vml.example/account/bookings",
    })

    expect(m.subject).toBe("Your booking AB12CD34 is confirmed")
    expect(m.text).toContain("Total paid: £25.00")
    expect(m.text).toContain("2 × Thames Walk: Morning, 1 Jun 2030, 10:00")
  })

  it("the vendor notice names the vendor and the reference", () => {
    const m = newBookingEmail({
      name: "Sam",
      vendorName: "Riverside Tours",
      bookingRef: "AB12CD34",
      lines: [line],
      dashboardUrl: "https://vml.example/vendor/listings",
    })

    expect(m.subject).toBe("New booking for Riverside Tours: AB12CD34")
    expect(m.text).toContain(
      "Booking reference: AB12CD34, for Riverside Tours."
    )
  })

  it("escapes a crafted name and title, so no markup gets into the email", () => {
    const m = bookingConfirmedEmail({
      name: "<img src=x onerror=alert(1)>",
      bookingRef: "AB12CD34",
      total: "£1.00",
      lines: [{ title: "<script>x()</script>", when: "now", places: 1 }],
      bookingsUrl: "https://vml.example/account/bookings",
    })

    expect(m.html).not.toContain("<img src=x")
    expect(m.html).not.toContain("<script>x()")
  })
})
