/**
 * Category page definitions: titles, copy, hero images and the filter groups
 * shown in the sidebar. Listings and their counts come from the database; the
 * facet option counts below are placeholders until filters are wired (E1-S1-05).
 */

const img = (topic: string, i = 1) =>
  `https://images.unsplash.com/${topic}?auto=format&fit=crop&w=800&q=70&ixid=${i}`

export type FacetGroup = {
  heading: string
  options: { label: string; count: number }[]
  collapsible?: boolean
}

export const DEFAULT_FACETS: FacetGroup[] = [
  {
    heading: "Venue Type",
    options: [
      { label: "Art Gallery", count: 24 },
      { label: "Museum", count: 24 },
      { label: "Theatre", count: 24 },
      { label: "Cultural Centre", count: 24 },
      { label: "Historic House", count: 24 },
      { label: "Architecture", count: 24 },
    ],
  },
  {
    heading: "Art Style",
    options: [
      { label: "Contemporary", count: 24 },
      { label: "Modern", count: 24 },
      { label: "Classical", count: 24 },
      { label: "Photography", count: 24 },
      { label: "Sculpture", count: 24 },
      { label: "Prints & Drawings", count: 24 },
      { label: "Street Art", count: 24 },
    ],
  },
  { heading: "Areas", options: [], collapsible: true },
  { heading: "Price", options: [], collapsible: true },
  { heading: "For", options: [], collapsible: true },
]

// Per-category page config: title, subtitle, hero image, result count, facets.
export type CategoryConfig = {
  slug: string
  title: string
  subtitle: string
  breadcrumb: string[]
  heroImage: string
  resultCount: number
  showPlaces: number
  facets: FacetGroup[]
}

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  "arts-culture": {
    slug: "arts-culture",
    title: "Arts & Culture",
    subtitle:
      "World-class museums, contemporary galleries, major exhibitions and cultural festivals — London is one of the great arts capitals of the world.",
    breadcrumb: ["Home", "Arts & Culture"],
    heroImage: img("photo-1543832923-44667a44c804", 2),
    resultCount: 1415,
    showPlaces: 267,
    facets: DEFAULT_FACETS,
  },
  attractions: {
    slug: "attractions",
    title: "London Attractions",
    subtitle:
      "From world-famous landmarks to hidden gems — explore over 1,000 things to see and do across the capital.",
    breadcrumb: ["Home", "Attractions"],
    heroImage: img("photo-1486299267070-83823f5448dd", 3),
    resultCount: 1415,
    showPlaces: 312,
    facets: DEFAULT_FACETS,
  },
  events: {
    slug: "events",
    title: "Events & Festivals",
    subtitle:
      "From the London Marathon to Notting Hill Carnival, Wimbledon to the BFI Film Festival — discover what's on across the capital year-round.",
    breadcrumb: ["Home", "Events & Festivals"],
    heroImage: img("photo-1492684223066-81342ee5ff30", 4),
    resultCount: 1415,
    showPlaces: 519,
    facets: DEFAULT_FACETS,
  },
  "food-drink": {
    slug: "food-drink",
    title: "Food & Drink in London",
    subtitle:
      "London's world-class food scene — Michelin-starred restaurants, legendary street markets, afternoon teas and rooftop dining with skyline views.",
    breadcrumb: ["Home", "Food & Drink"],
    heroImage: img("photo-1517248135467-4c7edcad34c4", 5),
    resultCount: 1415,
    showPlaces: 428,
    facets: DEFAULT_FACETS,
  },
  stay: {
    slug: "stay",
    title: "Stay in London",
    subtitle:
      "Find your perfect London hotel — five-star palaces on Park Lane, boutique gems in Soho, design hotels, serviced apartments and budget stays.",
    breadcrumb: ["Home", "Stay"],
    heroImage: img("photo-1611892440504-42a792e24d32", 6),
    resultCount: 1415,
    showPlaces: 478,
    facets: DEFAULT_FACETS,
  },
  tours: {
    slug: "tours",
    title: "Tours & Experiences",
    subtitle:
      "Discover London like never before — walking tours, river cruises, ghost adventures, helicopter flights and immersive experiences.",
    breadcrumb: ["Home", "Tours & Experiences"],
    heroImage: img("photo-1520637736862-4d197d17c38a", 7),
    resultCount: 1415,
    showPlaces: 187,
    facets: DEFAULT_FACETS,
  },
  nightlife: {
    slug: "nightlife",
    title: "Pubs, Bars & Nightlife",
    subtitle:
      "Tudor-era alehouses, legendary cocktail bars, rooftop terraces and underground speakeasies — London's drinking scene is without equal.",
    breadcrumb: ["Home", "Pubs, Bars & Nightlife"],
    heroImage: img("photo-1514933651103-005eec06c04b", 8),
    resultCount: 1415,
    showPlaces: 156,
    facets: DEFAULT_FACETS,
  },
  shopping: {
    slug: "shopping",
    title: "Shopping in London",
    subtitle:
      "From Harrods to Portobello Road — London is one of the world's great shopping capitals with luxury boutiques, vintage markets and iconic department stores.",
    breadcrumb: ["Home", "Shopping"],
    heroImage: img("photo-1441986300917-64674bd600d8", 9),
    resultCount: 1415,
    showPlaces: 203,
    facets: DEFAULT_FACETS,
  },
  "royal-london": {
    slug: "royal-london",
    title: "Royal London",
    subtitle:
      "Palaces, pageantry, Crown Jewels and centuries of royal history — explore Britain's royal heritage in the world's most famous royal city.",
    breadcrumb: ["Home", "Royal London"],
    heroImage: img("photo-1529655683826-aba9b3e77383", 10),
    resultCount: 1415,
    showPlaces: 89,
    facets: DEFAULT_FACETS,
  },
  music: {
    slug: "music",
    title: "Music & Shows in London",
    subtitle:
      "West End musicals, Proms at the Royal Albert Hall, world-class opera, legendary jazz clubs and the biggest live music venues in the world.",
    breadcrumb: ["Home", "Music"],
    heroImage: img("photo-1470229722913-7c0e2dbbafd3", 11),
    resultCount: 1415,
    showPlaces: 341,
    facets: DEFAULT_FACETS,
  },
  transport: {
    slug: "transport",
    title: "Transport & Travel",
    subtitle:
      "Navigate London with confidence — Tube maps, bus routes, river transport, Oyster cards, airport transfers, cycling and walking guides all in one place.",
    breadcrumb: ["Home", "Transport & Travel"],
    heroImage: img("photo-1513635269975-59663e0ac1ad", 12),
    resultCount: 1415,
    showPlaces: 143,
    facets: DEFAULT_FACETS,
  },
  explore: {
    slug: "explore",
    title: "Explore London",
    subtitle:
      "Areas, neighbourhoods, hidden corners and the London only locals know — filter by what you're looking for and find your own way in.",
    breadcrumb: ["Home", "Explore London"],
    heroImage: img("photo-1486299267070-83823f5448dd", 13),
    resultCount: 1415,
    showPlaces: 214,
    facets: DEFAULT_FACETS,
  },
}
