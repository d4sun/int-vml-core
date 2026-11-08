/** Newsletter band — "Plan Your Perfect London Trip" + email capture.
 *  Spec: #00247D background, Urbanist-900 heading, Geist body, #CF142B
 *  rounded (not pill) Subscribe button, translucent email field. */
export function NewsletterCta() {
  return (
    <section className="bg-[#00247D] text-white">
      <div className="mx-auto flex max-w-[1410px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-heading text-xl font-black leading-7 text-white">
            Plan Your Perfect London Trip
          </h3>
          <p className="mt-1 text-sm text-white/70">
            Get exclusive deals, insider guides, and London news in your inbox
          </p>
        </div>
        <form className="flex w-full gap-2 md:w-[384px]">
          <input
            type="email"
            placeholder="Your email address"
            className="h-[46px] flex-1 rounded-xl border border-white/20 bg-white/10 px-4 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/40"
          />
          <button
            type="submit"
            className="h-[46px] shrink-0 rounded-xl bg-[#CF142B] px-6 text-sm font-bold text-white transition-colors hover:bg-[#CF142B]/90"
          >
            Subscribe
          </button>
        </form>
      </div>
    </section>
  )
}
