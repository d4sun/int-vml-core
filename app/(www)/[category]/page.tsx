import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CategoryPage } from "@/components/brand/category-page"
import { CATEGORY_CONFIG } from "@/lib/mock-data"

// Statically render every known category slug.
export function generateStaticParams() {
  return Object.keys(CATEGORY_CONFIG).map((category) => ({ category }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const config = CATEGORY_CONFIG[category]
  if (!config) return {}
  return { title: config.title, description: config.subtitle }
}

export default async function CategoryRoute({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const config = CATEGORY_CONFIG[category]
  if (!config) notFound()
  return <CategoryPage config={config} />
}
