-- Verify 0081 — Due-Diligence foundation
-- Run after 0081_diligence_foundation.sql. Each block should return the
-- expected shape; eyeball the counts.

-- 1. All six tables exist.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'nurock_diligence_templates','nurock_diligence_items',
    'dm_diligence_deal_templates','dm_diligence_deal_items',
    'dm_diligence_documents','dm_diligence_item_documents'
  )
ORDER BY table_name;  -- expect 6 rows

-- 2. PUBLIC RLS policies (no roles) on every DD table.
SELECT c.relname AS table_name, p.polname, p.polroles::regrole[] AS roles
FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname LIKE '%diligence%'
ORDER BY c.relname;  -- roles should be {-} (PUBLIC) for each

-- 3. Single canonical template + its seeded item count.
SELECT t.slug, t.is_canonical, count(i.*) AS items
FROM nurock_diligence_templates t
LEFT JOIN nurock_diligence_items i ON i.template_id = t.id
GROUP BY t.slug, t.is_canonical;  -- nurock-standard / true / 59

-- 4. Items per category (sanity on grouping).
SELECT category, count(*) AS items
FROM nurock_diligence_items
GROUP BY category
ORDER BY min(item_number);

-- 5. Consistency CHECKs present on the spine table.
SELECT conname
FROM pg_constraint
WHERE conrelid = 'dm_diligence_deal_items'::regclass
  AND contype = 'c'
ORDER BY conname;  -- approved_chk + waive_reason_chk + status/required CHECKs

-- 6. Backfill: every deal adopted canonical + has the full item set.
SELECT
  (SELECT count(*) FROM deals) AS deals,
  (SELECT count(*) FROM dm_diligence_deal_templates) AS adoptions,
  (SELECT count(DISTINCT deal_id) FROM dm_diligence_deal_items) AS deals_with_items,
  (SELECT count(*) FROM dm_diligence_deal_items) AS deal_items;
  -- adoptions == deals; deals_with_items == deals; deal_items == deals * 59

-- 7. Storage bucket + realtime publication.
SELECT id, public FROM storage.buckets WHERE id = 'diligence-attachments';
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'dm_diligence_deal_items';
