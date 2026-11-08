import { Play, ChevronLeft, ChevronRight } from "lucide-react"
import { LONDON_VIDEOS } from "@/lib/mock-data"

/** Magenta "Discover more with London videos" band with a horizontal video rail. */
export function VideoBand() {
  return (
    <section className="bg-vml-pink text-white">
      <div className="mx-auto max-w-[1410px] px-4 py-12 sm:px-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="flex size-6 items-center justify-center rounded-full border border-white/40">
              <Play className="size-3 fill-white" />
            </span>
            <h2 className="mt-4 text-2xl font-bold">Discover more with London videos</h2>
            <p className="mt-2 max-w-md text-sm text-white/70">
              Want more information on things you can do and see in London? Watch the latest videos our
              team has put together!
            </p>
          </div>
          <div className="hidden gap-2 sm:flex">
            <RailButton><ChevronLeft className="size-4" /></RailButton>
            <RailButton><ChevronRight className="size-4" /></RailButton>
          </div>
        </div>

        <div className="no-scrollbar mt-6 flex gap-4 overflow-x-auto pb-2">
          {LONDON_VIDEOS.map((title) => (
            <div
              key={title}
              className="group relative flex aspect-video w-64 shrink-0 cursor-pointer items-end overflow-hidden rounded-lg bg-black/80"
            >
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-white/20 backdrop-blur transition-colors group-hover:bg-white/30">
                  <Play className="size-4 fill-white" />
                </span>
              </span>
              <span className="relative z-10 p-3 text-sm font-medium">{title}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <span className="h-1.5 w-6 rounded-full bg-white" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
        </div>
      </div>
    </section>
  )
}

function RailButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex size-9 items-center justify-center rounded-full border border-white/40 text-white transition-colors hover:bg-white/10">
      {children}
    </button>
  )
}
