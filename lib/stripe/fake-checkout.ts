/** The development stand-in for Stripe's hosted card page: two choices, and nothing else. */
export function renderFakeCheckoutPage(params: {
  session: string
  amountPence: number
}): string {
  const amount = `£${(params.amountPence / 100).toFixed(2)}`
  const base = `/api/dev/stripe-fake/checkout?session=${encodeURIComponent(params.session)}`

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Test checkout (development only)</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto;">
  <h1>Test checkout</h1>
  <p>Development only. Pay ${amount} with no card.</p>
  <p><a href="${base}&amp;outcome=paid" style="font-weight: 600;">Pay ${amount}</a></p>
  <p><a href="${base}&amp;outcome=cancel">Cancel and go back</a></p>
</body>
</html>`
}
