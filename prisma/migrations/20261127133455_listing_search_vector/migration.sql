-- Full-text search over a listing's title and description (E1-S1-01).
-- The column is generated, so it can never drift from the text it indexes.
-- Prisma cannot express generated columns, so the schema reads it as
-- Unsupported("tsvector") and never writes it.
ALTER TABLE "Listing"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "Listing_search_idx" ON "Listing" USING GIN ("search");
