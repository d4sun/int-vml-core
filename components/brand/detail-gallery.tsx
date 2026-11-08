import Image from "next/image"
import { LayoutGrid } from "lucide-react"

/** 1 large + 4 thumbnail gallery grid used on detail pages, with a "+N photos" overlay. */
export function DetailGallery({ images, extra = 5 }: { images: string[]; extra?: number }) {
  const [hero, ...thumbs] = images
  const padded = [...thumbs]
  while (padded.length < 4) padded.push(hero)

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl md:col-span-2 md:row-span-2 md:aspect-auto">
        <Image src={hero} alt="" fill priority sizes="(max-width:768px) 100vw, 66vw" className="object-cover" />
      </div>
      {padded.slice(0, 4).map((src, i) => (
        <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-xl md:aspect-auto">
          <Image src={src} alt="" fill sizes="(max-width:768px) 50vw, 22vw" className="object-cover" />
          {i === 3 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
              <LayoutGrid className="size-5" />
              <span className="text-sm font-medium">+{extra} photos</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
