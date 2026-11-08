"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { LayoutGrid, X, ChevronLeft, ChevronRight } from "lucide-react"

/** Detail-page gallery: one large image on the left, a 2×2 grid of four
 *  thumbnails on the right. Clicking any image opens a full-screen lightbox
 *  slider to browse all photos. */
export function DetailGallery({ images, extra = 5 }: { images: string[]; extra?: number }) {
  const [hero, ...thumbs] = images
  const padded = [...thumbs]
  while (padded.length < 4) padded.push(hero)
  const tiles = padded.slice(0, 4)

  const [openAt, setOpenAt] = useState<number | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:h-[480px] md:grid-cols-2">
        {/* Large hero — left half */}
        <button
          type="button"
          onClick={() => setOpenAt(0)}
          className="relative h-72 cursor-pointer overflow-hidden rounded-xl md:h-full"
          aria-label="Open photo 1"
        >
          <Image src={hero} alt="" fill priority sizes="(max-width:768px) 100vw, 50vw" className="object-cover transition-transform duration-300 hover:scale-105" />
        </button>

        {/* 2×2 thumbnails — right half */}
        <div className="grid h-72 grid-cols-2 grid-rows-2 gap-3 md:h-full">
          {tiles.map((src, i) => (
            <button
              type="button"
              key={i}
              onClick={() => setOpenAt(i + 1 < images.length ? i + 1 : 0)}
              className="relative h-full w-full cursor-pointer overflow-hidden rounded-xl"
              aria-label={`Open photo ${i + 2}`}
            >
              <Image src={src} alt="" fill sizes="(max-width:768px) 50vw, 25vw" className="object-cover transition-transform duration-300 hover:scale-105" />
              {i === 3 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
                  <LayoutGrid className="size-5" />
                  <span className="text-sm font-medium">+{extra} photos</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {openAt !== null && (
        <Lightbox images={images} startIndex={openAt} onClose={() => setOpenAt(null)} />
      )}
    </>
  )
}

function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: string[]
  startIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + images.length) % images.length),
    [images.length]
  )
  const next = useCallback(
    () => setIndex((i) => (i + 1) % images.length),
    [images.length]
  )

  // Keyboard controls + lock body scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") prev()
      else if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, prev, next])

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-medium">
          {index + 1} / {images.length}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={prev}
          aria-label="Previous photo"
          className="absolute left-4 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronLeft className="size-6" />
        </button>

        <div className="relative h-full max-h-[75vh] w-full max-w-5xl">
          <Image
            key={index}
            src={images[index]}
            alt={`Photo ${index + 1}`}
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
        </div>

        <button
          onClick={next}
          aria-label="Next photo"
          className="absolute right-4 z-10 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronRight className="size-6" />
        </button>
      </div>

      {/* Thumbnail strip */}
      <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-5" onClick={(e) => e.stopPropagation()}>
        {images.map((src, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
              i === index ? "ring-white" : "ring-transparent opacity-60 hover:opacity-100"
            }`}
            aria-label={`Go to photo ${i + 1}`}
          >
            <Image src={src} alt="" fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
