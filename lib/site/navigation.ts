/**
 * Site navigation and footer: the static chrome that every page shares. This is
 * configuration, not listing data; listings always come from the database.
 */

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

export type FooterColumn = {
  heading: string
  links: { label: string; href: string }[]
}

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
