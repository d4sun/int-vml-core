// Static mock data for the UI build. No backend — these shapes are deliberately
// loose and presentation-oriented, not the Prisma domain model. They exist only
// to populate the screens while we build the interface.

export type NavItem = {
  label: string
  href: string
  children?: { label: string; href: string }[]
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Home", href: "/" },
  {
    label: "Explore London",
    href: "/explore",
    children: [
      { label: "Attractions", href: "/attractions" },
      { label: "Areas & Neighbourhoods", href: "/explore" },
      { label: "Royal London", href: "/royal-london" },
      { label: "Arts & Culture", href: "/arts-culture" },
    ],
  },
  {
    label: "Things to do",
    href: "/things-to-do",
    children: [
      { label: "Tours & Experiences", href: "/tours" },
      { label: "Events & Festivals", href: "/events" },
      { label: "Music & Shows", href: "/music" },
      { label: "Pubs, Bars & Nightlife", href: "/nightlife" },
    ],
  },
  {
    label: "Food & Drink",
    href: "/food-drink",
    children: [
      { label: "Restaurants", href: "/food-drink" },
      { label: "Pubs, Bars & Nightlife", href: "/nightlife" },
    ],
  },
  {
    label: "Stay",
    href: "/stay",
    children: [
      { label: "Hotels", href: "/stay" },
      { label: "Shopping", href: "/shopping" },
    ],
  },
  { label: "Transport", href: "/transport" },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
]

// The horizontal pill row that sits above the listing grid.
export const CATEGORY_PILLS: { label: string; href: string }[] = [
  { label: "Explore London", href: "/explore" },
  { label: "Attractions", href: "/attractions" },
  { label: "Tours & Experiences", href: "/tours" },
  { label: "Food & Drink", href: "/food-drink" },
  { label: "Pubs, Bars & Nightlife", href: "/nightlife" },
  { label: "Shopping", href: "/shopping" },
  { label: "Royal London", href: "/royal-london" },
  { label: "Arts & Culture", href: "/arts-culture" },
  { label: "Stay", href: "/stay" },
  { label: "Transport & Travel", href: "/transport" },
  { label: "Book & Buy", href: "/book" },
  { label: "Events & Festivals", href: "/events" },
  { label: "Music", href: "/music" },
]

export type FooterColumn = { heading: string; links: { label: string; href: string }[] }

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Explore",
    links: [
      { label: "Explore London", href: "/explore" },
      { label: "Attractions", href: "/attractions" },
      { label: "Tours & Experiences", href: "/tours" },
      { label: "Food & Drink", href: "/food-drink" },
      { label: "Royal London", href: "/royal-london" },
      { label: "Arts & Culture", href: "/arts-culture" },
      { label: "Music", href: "/music" },
      { label: "Events & Festivals", href: "/events" },
      { label: "Shopping", href: "/shopping" },
      { label: "Stay", href: "/stay" },
      { label: "Transport & Travel", href: "/transport" },
      { label: "Book & Buy", href: "/book" },
      { label: "Shop", href: "/shop" },
      { label: "Blog & Journal", href: "/blog" },
      { label: "AI Concierge", href: "/concierge" },
    ],
  },
  {
    heading: "About",
    links: [
      { label: "About Visit My London", href: "/about" },
      { label: "Our Story", href: "/about/story" },
      { label: "Editorial Team", href: "/about/team" },
      { label: "Careers", href: "/careers" },
      { label: "Contact Us", href: "/contact" },
    ],
  },
  {
    heading: "Partners",
    links: [
      { label: "Partner With Us", href: "/partners" },
      { label: "Advertise", href: "/advertise" },
      { label: "List Your Business", href: "/list-your-business" },
      { label: "Affiliate Programme", href: "/affiliate" },
      { label: "Tourism Partners", href: "/tourism-partners" },
      { label: "Press Centre", href: "/press" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Help Centre", href: "/help" },
      { label: "Booking Support", href: "/help/booking" },
      { label: "Accessibility", href: "/accessibility" },
      { label: "Safety Information", href: "/safety" },
      { label: "Report an Issue", href: "/report" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Cookie Policy", href: "/legal/cookies" },
      { label: "Terms & Conditions", href: "/legal/terms" },
      { label: "Booking Terms", href: "/legal/booking-terms" },
      { label: "Affiliate Disclosure", href: "/legal/affiliate-disclosure" },
    ],
  },
  {
    heading: "Connect",
    links: [
      { label: "Newsletter", href: "/newsletter" },
      { label: "Facebook", href: "https://facebook.com" },
      { label: "Instagram", href: "https://instagram.com" },
      { label: "TikTok", href: "https://tiktok.com" },
      { label: "YouTube", href: "https://youtube.com" },
      { label: "Pinterest", href: "https://pinterest.com" },
    ],
  },
]

// ---------------------------------------------------------------------------
// Listing cards (the 3-up grid on every category page)
// ---------------------------------------------------------------------------

export type ListingCard = {
  id: string
  slug: string
  eyebrow: string // red category label, e.g. "ARTS CULTURE GALLERIES"
  title: string
  meta: string // "South Bank · Free entry · Open daily"
  tag: string // green pill, e.g. "Free Entry"
  image: string
  saved?: boolean
}

// Deterministic Unsplash source URLs keyed by topic — fine for a static UI pass.
const img = (topic: string, i = 1) =>
  `https://images.unsplash.com/${topic}?auto=format&fit=crop&w=800&q=70&ixid=${i}`

export const SAMPLE_LISTINGS: ListingCard[] = [
  {
    id: "1",
    slug: "tate-modern",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Tate Modern",
    meta: "South Bank · Free entry · Open daily",
    tag: "Free Entry",
    image: img("photo-1554907984-15263bfd63bd"),
  },
  {
    id: "2",
    slug: "natural-history-museum",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Natural History Museum",
    meta: "South Kensington · Free entry",
    tag: "Free Entry",
    image: img("photo-1574717024653-61fd2cf4d44d"),
  },
  {
    id: "3",
    slug: "national-gallery",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "National Gallery",
    meta: "Trafalgar Square · Free entry",
    tag: "Free Entry",
    image: img("photo-1577083552431-6e5fd01aa342"),
  },
  {
    id: "4",
    slug: "royal-academy-of-arts",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Royal Academy of Arts",
    meta: "Piccadilly · Burlington House",
    tag: "Major Exhibitions",
    image: img("photo-1518998053901-5348d3961a04"),
  },
  {
    id: "5",
    slug: "barbican-centre",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Barbican Centre",
    meta: "Barbican · City of London",
    tag: "Arts Centre",
    image: img("photo-1533929736458-ca588d08c8be"),
  },
  {
    id: "6",
    slug: "whitechapel-gallery",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Whitechapel Gallery",
    meta: "Whitechapel · East London",
    tag: "Contemporary",
    image: img("photo-1499781350541-7783f6c6a0c8"),
  },
  {
    id: "7",
    slug: "design-museum",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Design Museum",
    meta: "Kensington · Holland Park",
    tag: "Design",
    image: img("photo-1605429523419-d828acb941d9"),
  },
  {
    id: "8",
    slug: "hayward-gallery",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Hayward Gallery",
    meta: "South Bank · Belvedere Road",
    tag: "Contemporary",
    image: img("photo-1536924940846-227afb31e2a5"),
  },
  {
    id: "9",
    slug: "serpentine-galleries",
    eyebrow: "ARTS CULTURE GALLERIES",
    title: "Serpentine Galleries",
    meta: "Kensington Gardens · Free entry",
    tag: "Free Entry",
    image: img("photo-1566054757965-8c4085344c96"),
  },
]

// "More experiences nearby" / booking carousel row
export type ExperienceCard = {
  id: string
  tag: string // small label pill: LANDMARKS, MUSEUMS, ATTRACTIONS…
  title: string
  area: string
  price: string // "from £10.60" | "Free entry"
  image: string
}

export const NEARBY_EXPERIENCES: ExperienceCard[] = [
  { id: "n1", tag: "LANDMARKS", title: "Tower Bridge Exhibition", area: "City of London", price: "from £10.60", image: img("photo-1529655683826-aba9b3e77383") },
  { id: "n2", tag: "MUSEUMS", title: "Churchill War Rooms", area: "Westminster", price: "from £25.00", image: img("photo-1543832923-44667a44c804") },
  { id: "n3", tag: "ATTRACTIONS", title: "The Shard View", area: "London Bridge", price: "from £28.00", image: img("photo-1513635269975-59663e0ac1ad") },
  { id: "n4", tag: "GALLERIES", title: "Tate Modern", area: "South Bank", price: "Free entry", image: img("photo-1554907984-15263bfd63bd") },
  { id: "n5", tag: "THEATRE", title: "Shakespeare's Globe", area: "Bankside", price: "from £18.00", image: img("photo-1503095396549-807759245b35") },
  { id: "n6", tag: "MUSEUMS", title: "HMS Belfast", area: "Southwark", price: "from £25.00", image: img("photo-1520986606214-8b456906c813") },
  { id: "n7", tag: "EXPERIENCES", title: "London Eye", area: "South Bank", price: "from £29.00", image: img("photo-1532375810709-75b1da00537c") },
]

export const LONDON_VIDEOS = [
  "Theatre in London",
  "London Eye Champagne Experience",
  "Westminster Abbey",
  "Tower of London",
  "Hop-on Hop-off Bus",
]

// ---------------------------------------------------------------------------
// Filter facets for the category sidebar — keyed by category slug.
// ---------------------------------------------------------------------------

export type FacetGroup = { heading: string; options: { label: string; count: number }[]; collapsible?: boolean }

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
    subtitle: "From world-famous landmarks to hidden gems — explore over 1,000 things to see and do across the capital.",
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
