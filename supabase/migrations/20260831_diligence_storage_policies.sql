-- ============================================================================
-- diligence-attachments — the storage policies 0081 never created
-- ============================================================================
-- MEASURED LIVE 2026-08-31:
--   storage.objects RLS enabled            : true
--   diligence-attachments bucket exists    : yes, public = false
--   objects in that bucket                 : 0
--   policies on storage.objects for it     : NONE
--
-- `0081_diligence_foundation.sql:252-255` creates the bucket and stops there —
-- the six policy statements in that file are all table policies. So the bucket
-- has RLS on and no policy, which means DENY. The first person to attach a
-- document will have the upload refused at the storage layer, and
-- uploadDiligenceDocument returns before writing a row, so the symptom is an
-- upload that silently does not happen. Whoever tests it will reasonably file it
-- as an application bug.
--
-- This is preventive, not remedial: the CFO confirmed on 2026-08-31 that the DD
-- platform has not been properly tested and no attachment has ever been
-- attempted. Zero objects is explained by "nobody tried", not by failure. Apply
-- this BEFORE attachment testing so the test exercises the app rather than a
-- missing policy.
--
-- ---------------------------------------------------------------------------
-- THE PATTERN IS ALREADY IN THIS DATABASE
-- ---------------------------------------------------------------------------
-- The `dm-draws` / `dm-invoices` / `dm-documents` buckets carry a correct
-- per-deal predicate:
--
--   dm_storage_select  SELECT {authenticated}
--     (bucket_id = ANY (ARRAY['dm-draws','dm-invoices','dm-documents'])
--      AND dm_user_has_access((storage.…
--
-- `dm_user_has_access(p_deal_id text, p_min_role text DEFAULT …) -> boolean`
-- exists live (confirmed in the generated types) but its DEFINITION IS IN NO
-- MIGRATION IN ANY REPO — the fifth out-of-band object this review has found,
-- after the gl_to_format_line split columns, the deal_promote_status view, the
-- v8_legacy realign, and the storage policies themselves. Capturing it into a
-- migration is logged as still owed.
--
-- The diligence storage key is `{dealId}/{dealItemId}/{uuid}{ext}`
-- (src/lib/diligence/storage.ts:82-89), so the deal id is the FIRST path
-- segment — exactly what `(storage.foldername(name))[1]` returns, and the same
-- shape the dm_storage_* policies rely on.
--
-- ⚠️ ONE LINE TO VERIFY BEFORE APPLYING. The live dm_storage_* qual was read
-- truncated, so the exact `dm_user_has_access(...)` call — specifically whether
-- it passes a second p_min_role argument — is assumed here to be the one-argument
-- form. Run the pre-flight below and, if the existing policies pass a role, add
-- the same argument to the four policies here. Everything else is unaffected.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- * Does not touch `invoice-attachments`. Its policies are role `{public}` with
--   only a `bucket_id` predicate and no access term, which is a real exposure —
--   but that bucket holds LIVE FILES and its key format could not be established
--   from the call sites (callers pass `path` in). Changing it without knowing
--   whether its keys begin with a deal id could orphan every existing invoice
--   attachment. It needs its own pass. Note also that a properly-scoped
--   `dm-invoices` bucket exists alongside it, so there may be two generations
--   coexisting — worth resolving before retrofitting either.
--
-- * Does not fix `getDiligenceDocSignedUrl` (diligence/actions.ts ~:608), which
--   is an unguarded server action taking an ARBITRARY filePath. After this
--   migration, storage RLS becomes a real backstop for it under the Supabase
--   provider — which is a genuine improvement over none. But under the
--   SharePoint provider (app-only Graph credentials, Sites.ReadWrite.All) it
--   remains a complete bypass, because those requests never touch
--   storage.objects. The action still needs its own authorization check.
--
-- * Does not scope reads more tightly than writes. A user who can reach the deal
--   can read its attachments; one who cannot, cannot. That mirrors
--   dm_user_has_access's own semantics rather than inventing a second model.
-- ============================================================================

BEGIN;

-- Idempotent: drop by exact name first so re-running is safe.
DROP POLICY IF EXISTS diligence_attachments_select ON storage.objects;
DROP POLICY IF EXISTS diligence_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS diligence_attachments_update ON storage.objects;
DROP POLICY IF EXISTS diligence_attachments_delete ON storage.objects;

CREATE POLICY diligence_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'diligence-attachments'
    AND dm_user_has_access((storage.foldername(name))[1])
  );

-- INSERT policies carry only WITH CHECK — mirroring dm_storage_insert, whose
-- using_clause reads (none).
CREATE POLICY diligence_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'diligence-attachments'
    AND dm_user_has_access((storage.foldername(name))[1])
  );

CREATE POLICY diligence_attachments_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'diligence-attachments'
    AND dm_user_has_access((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'diligence-attachments'
    AND dm_user_has_access((storage.foldername(name))[1])
  );

-- DELETE is required: unlinkDiligenceDocument removes the storage object when no
-- item still links the document (diligence/actions.ts ~:450).
CREATE POLICY diligence_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'diligence-attachments'
    AND dm_user_has_access((storage.foldername(name))[1])
  );

COMMIT;

-- ============================================================================
-- PRE-FLIGHT — read-only, run BEFORE the BEGIN block
-- ============================================================================
-- 1. THE ONE THAT MATTERS: read the existing dm_storage_* qual IN FULL, so the
--    dm_user_has_access call above matches it exactly. If it passes a second
--    argument (a minimum role), add the same argument to all four policies here.
--
--   select policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'dm_storage%'
--    order by policyname;
--
-- 2. Confirm the function exists and check whether p_min_role has a default:
--
--   select p.proname,
--          pg_get_function_arguments(p.oid) as args,
--          p.prosecdef                      as is_security_definer
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'dm_user_has_access';
--
--    NOTE: if this is NOT security definer, it reads its underlying access table
--    as the caller and may be subject to that table's RLS — worth knowing, since
--    the dm_storage_* policies already depend on it and would share the issue.
--
-- 3. Confirm the bucket is still empty, so this cannot orphan anything:
--
--   select count(*) from storage.objects where bucket_id = 'diligence-attachments';
--
--    Expect 0. A non-zero count means someone uploaded between the measurement
--    and now — stop and re-check the key format before applying.
--
-- ============================================================================
-- VERIFICATION — after applying
-- ============================================================================
-- 1. Four policies, TO authenticated, all naming the bucket.
--
--   select policyname, cmd, roles::text,
--          left(coalesce(qual, with_check),90) as predicate
--     from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'diligence_attachments%'
--    order by policyname;
--
-- 2. FUNCTIONAL — and this is the test the whole file exists for. In the
--    diligence app, on a deal you can reach:
--      a. Attach a document to a checklist item. THE UPLOAD MUST SUCCEED.
--      b. Confirm a dm_diligence_documents row appeared AND an object landed in
--         the bucket:
--           select count(*) from public.dm_diligence_documents;
--           select count(*) from storage.objects where bucket_id='diligence-attachments';
--         Both should read 1. A row with no object, or an object with no row, is
--         the half-committed state the audit warned about — report it.
--      c. Open the document from the checklist. The signed URL must resolve.
--      d. Unlink it. Both the row and the object must disappear.
--
--    THE FALSIFYING OBSERVATION, stated in advance: if (a) still fails, the
--    dm_user_has_access call shape is wrong — most likely it needs the second
--    argument. Compare against the dm_storage_* qual from pre-flight 1 rather
--    than guessing again.
--
-- 3. Confirm the OTHER buckets are untouched — dm-draws / dm-invoices /
--    dm-documents and invoice-attachments must all still work. Upload an invoice
--    attachment on any deal to prove it.
--
-- ============================================================================
-- ROLLBACK — returns the bucket to deny-all, which is its current state
-- ============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS diligence_attachments_select ON storage.objects;
-- DROP POLICY IF EXISTS diligence_attachments_insert ON storage.objects;
-- DROP POLICY IF EXISTS diligence_attachments_update ON storage.objects;
-- DROP POLICY IF EXISTS diligence_attachments_delete ON storage.objects;
-- COMMIT;
--
-- ============================================================================
-- STILL OWED
-- ============================================================================
-- 1. Capture dm_user_has_access's definition into a migration. It is live, it is
--    load-bearing for four buckets, and it exists in no repo.
-- 2. Retrofit invoice-attachments off its {public} blanket, after establishing
--    its key format and resolving the invoice-attachments vs dm-invoices overlap.
-- 3. Give getDiligenceDocSignedUrl its own authorization check — storage RLS is
--    now a backstop under Supabase but not under SharePoint.
-- ============================================================================
