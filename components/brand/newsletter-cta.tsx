import { Button } from "@/components/ui/button"

/** Blue band: "Plan Your Perfect London Trip" + email capture. */
export function NewsletterCta() {
  return (
    <section className="bg-vml-navy text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">Plan Your Perfect London Trip</h2>
          <p className="mt-1 text-sm text-white/70">
            Get exclusive deals, insider guides, and London news in your inbox
          </p>
        </div>
        <form className="flex w-full max-w-md gap-2">
          <input
            type="email"
            placeholder="Your email address"
            className="h-11 flex-1 rounded-lg border border-white/20 bg-white px-4 text-sm text-vml-ink placeholder:text-muted-foreground outline-none focus:border-white/60"
          />
          <Button
            size="lg"
            className="h-11 rounded-lg bg-vml-red px-6 text-white hover:bg-vml-red/90"
          >
            Subscribe
          </Button>
        </form>
      </div>
    </section>
  )
}
