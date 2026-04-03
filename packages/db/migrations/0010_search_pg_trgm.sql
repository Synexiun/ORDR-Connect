-- ============================================================================
-- Migration 0010 — Search: pg_trgm extension + trigram indexes
--
-- Enables production-grade fuzzy matching for the search_index table.
--
-- Why pg_trgm:
--   - ILIKE on large tables does sequential scans — pg_trgm GIN indexes allow
--     ILIKE, similarity(), and word_similarity() to use index lookups.
--   - Required for websearch_to_tsquery fuzzy fallback in DrizzleSearchStore.
--
-- Compliance:
--   SOC2 CC6.1 — All queries remain tenant-scoped. Indexes don't bypass RLS.
--   ISO 27001 A.8.1 — Indexes are on PHI-masked columns only (display_title,
--     display_subtitle). Raw PII is never in the search index.
-- ============================================================================

BEGIN;

-- Enable pg_trgm — idempotent, safe to run multiple times.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on display_title — enables fast ILIKE + similarity()
-- for autocomplete suggest() and fuzzy title matching.
CREATE INDEX IF NOT EXISTS search_index_title_trgm
  ON search_index USING gin(display_title gin_trgm_ops);

-- GIN trigram index on display_subtitle — enables cross-field fuzzy search.
CREATE INDEX IF NOT EXISTS search_index_subtitle_trgm
  ON search_index USING gin(display_subtitle gin_trgm_ops);

COMMIT;
