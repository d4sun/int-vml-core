import { describe, expect, it } from "vitest"
import { formatFromPrice, toListingCards } from "@/lib/listings/card"
import { buildListingJsonLd, jsonLdScript } from "@/lib/listings/json-ld"
import type { PublicListing } from "@/lib/listings/public"
import { searchInputFromParams } from "@/lib/search/params"

const listing: PublicListing = {
  id: "l1",
  slug: "thames-walk",
  title: "Thames Walk",
  description: "A walk along the river.",
  address: "South Bank, SE1",
  lat: 51.5,
  lng: -0.12,
  categoryName: "Tours",
  vendorName: "Riverside Tours",
  products: [
    { id: "p1", name: "Morning", basePrice: 1250, cancelWindowHours: 24 },
  ],
  imageKeys: [],
}

describe("price labels", () => {
  it("shows the cheapest price in pounds, or no price", () => {
    expect(formatFromPrice(1250)).toBe("From £12.50")
    expect(formatFromPrice(0)).toBe("From £0.00")
    expect(formatFromPrice(null)).toBe("Price on request")
  })
})

describe("card data from search results", () => {
  it("resolves picture URLs only where a picture exists", () => {
    const [withPicture, withoutPicture] = toListingCards(
      [
        {
          id: "a",
          slug: "a",
          title: "A",
          categoryName: "Tours",
          vendorName: "V",
          fromPrice: 100,
          imageKey: "k1",
        },
        {
          id: "b",
          slug: "b",
          title: "B",
          categoryName: "Tours",
          vendorName: "V",
          fromPrice: null,
          imageKey: null,
        },
      ],
      (key) => `https://cdn.example/${key}`
    )

    expect(withPicture?.imageUrl).toBe("https://cdn.example/k1")
    expect(withoutPicture?.imageUrl).toBeNull()
  })
})

describe("listing structured data", () => {
  it("describes the listing with its real offers and location", () => {
    const data = buildListingJsonLd(
      listing,
      "https://vml.example/listings/thames-walk"
    )

    expect(data["@type"]).toBe("TouristAttraction")
    expect(data.name).toBe("Thames Walk")
    expect(data.offers).toEqual([
      expect.objectContaining({ price: "12.50", priceCurrency: "GBP" }),
    ])
    expect(data.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 51.5,
      longitude: -0.12,
    })
  })

  it("invents nothing: no offers, address or location when the listing has none", () => {
    const data = buildListingJsonLd(
      {
        ...listing,
        products: [],
        address: null,
        lat: null,
        lng: null,
        description: null,
      },
      "https://vml.example/listings/x"
    )

    expect(data).not.toHaveProperty("offers")
    expect(data).not.toHaveProperty("address")
    expect(data).not.toHaveProperty("geo")
    expect(data).not.toHaveProperty("description")
    expect(data).not.toHaveProperty("aggregateRating")
  })

  it("escapes < so no text can close the script tag", () => {
    const script = jsonLdScript({ name: "</script><script>alert(1)</script>" })

    expect(script).not.toContain("</script>")
    expect(script).toContain("\\u003c/script")
  })
})

describe("URL search parameters", () => {
  it("reads numbers and text, and drops absent keys", () => {
    const input = searchInputFromParams({
      q: "thames",
      minPrice: "500",
      page: "2",
    })

    expect(input).toEqual({ q: "thames", minPrice: 500, page: 2 })
  })

  it("keeps a non-number as NaN so the schema refuses it", () => {
    const input = searchInputFromParams({ minPrice: "lots" })

    expect(Number.isNaN(input.minPrice)).toBe(true)
  })

  it("repeated keys are ignored rather than trusted", () => {
    expect(searchInputFromParams({ q: ["a", "b"] })).toEqual({ page: 1 })
  })
})
