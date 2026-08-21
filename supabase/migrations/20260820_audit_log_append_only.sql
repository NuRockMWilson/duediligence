-- ============================================================================
-- dm_diligence_audit_log — make it APPEND-ONLY, which is what the code already
-- believes it is
--
-- *** APPLIED BY THE OWNER 2026-08-20. Ran successfully. ***
--
-- VERIFIED after: no ALL/UPDATE/DELETE policy remains on the table, and
-- UPDATE/DELETE/TRUNCATE are revoked from both anon and authenticated. The log is
-- append-only on both layers.
-- STILL OWED: the functional test in VERIFICATION 4 — generate an event and
-- confirm it APPEARS. The writer swallows its error, so a missing row is the only
-- symptom a broken INSERT policy would produce.
-- ============================================================================
-- WHAT IS THERE NOW
-- ============================================================================
-- 0098 created it with:
--
--     ALTER TABLE dm_diligence_audit_log ENABLE ROW LEVEL SECURITY;
--     CREATE POLICY dm_diligence_audit_log_all ON dm_diligence_audit_log
--       FOR ALL USING (true) WITH CHECK (true);
--
-- No TO clause, so the policy reaches `public` — every role. FOR ALL, so it
-- covers UPDATE and DELETE as well as SELECT and INSERT. RLS is enabled, which
-- makes the table look protected in a catalog sweep while permitting everything.
--
-- AN AUDIT LOG THAT ANY PERMITTED CALLER CAN REWRITE OR EMPTY IS WORSE THAN NO
-- AUDIT LOG, because it still reads as evidence. That is the same defect class as
-- approved_by sitting empty on 263 invoices while looking like a record of who
-- approved them, and as the "Posted" label that concealed a review queue: a thing
-- whose appearance asserts something its content does not support.
--
-- MEASURED 2026-08-20: `authenticated` holds INSERT, UPDATE and DELETE on 61 of
-- the 64 tables in public, and this is one of them. So the permission to rewrite
-- history is not theoretical — it is held by every signed-in user of any role.
-- (anon holds no DML anywhere, confirmed as a demonstrated negative, so this is an
-- any-logged-in-user problem rather than an internet-facing one.)
--
-- ============================================================================
-- WHY THIS CANNOT BREAK ANYTHING — CHECKED, NOT ASSUMED
-- ============================================================================
-- The whole risk in restricting a permission is locking out a working feature, so
-- this was swept across all three repos before being written. dm_diligence_audit_log
-- is touched in EXACTLY TWO PLACES, and neither mutates a row:
--
--   nurock-diligence/src/lib/diligence/audit.ts:40   .insert({...})
--     Its own header comment reads: "Best-effort, APPEND-ONLY event writer for
--     dm_diligence_audit_log". The code already believes what this migration
--     enforces.
--
--   nurock-diligence/src/app/(app)/deals/[dealId]/audit/page.tsx:62   .select(...)
--     Newest-first event log for the audit screen. Read only.
--
-- No UPDATE, no DELETE, no TRUNCATE — in any app, any migration, or any script in
-- any of the three repos. There is no retention job and no "clear log" action to
-- break. This migration removes a capability nothing uses and nothing should.
--
-- ============================================================================
-- WHY SPLIT THE POLICY RATHER THAN NARROW THE EXISTING ONE
-- ============================================================================
-- One FOR ALL policy cannot express "insert yes, update never": USING and
-- WITH CHECK apply per command, but a single ALL policy admitting INSERT also
-- admits UPDATE and DELETE unless separate per-command policies exist. So the
-- shape has to be one policy per command, and the absence of an UPDATE or DELETE
-- policy is what denies them — RLS denies by default when no policy matches.
--
-- Scoped TO authenticated rather than left as public, per the 0076 pattern that
-- has worked in this project since it was applied to dm_retainage_releases and
-- never rolled back. The "TO authenticated silently fails" convention repeated on
-- the dm_ tables is a misdiagnosis; what actually broke 0077 was ORDER, not the
-- TO clause.
--
-- SELECT AND INSERT ARE DELIBERATELY NOT PERMISSION-GATED beyond being signed in.
-- An event writer that fails because the actor lacks a role would drop audit
-- events on the floor, which is strictly worse than recording them — and the
-- writer is best-effort by design, so it would fail SILENTLY. Anyone who can act
-- in the module must be able to record that they acted. Restricting who may READ
-- the log is a separate decision and is not made here.
-- ============================================================================

BEGIN;

ALTER TABLE public.dm_diligence_audit_log ENABLE ROW LEVEL SECURITY;

-- The permissive one goes. Named exactly as 0098 created it.
DROP POLICY IF EXISTS dm_diligence_audit_log_all ON public.dm_diligence_audit_log;

-- Read: any signed-in user. Matches the audit screen's existing behaviour.
DROP POLICY IF EXISTS dm_diligence_audit_log_select ON public.dm_diligence_audit_log;
CREATE POLICY dm_diligence_audit_log_select ON public.dm_diligence_audit_log
  FOR SELECT TO authenticated
  USING (true);

-- Append: any signed-in user, so no actor is unable to record their own action.
DROP POLICY IF EXISTS dm_diligence_audit_log_insert ON public.dm_diligence_audit_log;
CREATE POLICY dm_diligence_audit_log_insert ON public.dm_diligence_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- NO UPDATE POLICY AND NO DELETE POLICY. Their ABSENCE is the control: RLS denies
-- any command no policy admits. Do not "tidy" this by adding a FOR ALL policy —
-- that is precisely the state being removed.

-- Belt, and independent of RLS: TRUNCATE IS NOT GOVERNED BY ROW SECURITY AT ALL.
-- The schema-wide revoke of 2026-08-20 already removed it from authenticated, but
-- naming it here means this table stays append-only even if a future table-level
-- grant re-opens it. Same for UPDATE and DELETE — two layers, since a policy alone
-- would leave the privilege in place.
REVOKE UPDATE, DELETE, TRUNCATE ON public.dm_diligence_audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.dm_diligence_audit_log FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Exactly two policies, and no ALL. Expect SELECT and INSERT, both
--    {authenticated}.
--
--   select policyname, cmd, roles::text, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'dm_diligence_audit_log'
--    order by policyname;
--
-- 2. The privilege half. Expect INSERT and SELECT only for authenticated, and
--    NOTHING for anon.
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'dm_diligence_audit_log'
--      and grantee in ('anon','authenticated')
--    order by 1, 2;
--
-- 3. REACHABILITY, which is the question the grants table cannot answer — it
--    shows DIRECT grants only and misses privileges held via PUBLIC or role
--    membership. Pass the OID, never a concatenated name. Expect t, t, f, f, f.
--
--   select has_table_privilege('authenticated', c.oid, 'select') as sel,
--          has_table_privilege('authenticated', c.oid, 'insert') as ins,
--          has_table_privilege('authenticated', c.oid, 'update') as upd,
--          has_table_privilege('authenticated', c.oid, 'delete') as del,
--          has_table_privilege('authenticated', c.oid, 'truncate') as trunc
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'dm_diligence_audit_log';
--
-- 4. THE FUNCTIONAL TEST, and it is the one that matters. In the diligence app,
--    signed in: perform an action that generates an audit event — a status change
--    or a sign-off — then open the deal's Audit screen and confirm the new event
--    APPEARS. THE FALSIFYING OBSERVATION, stated in advance: if the event is
--    missing, the INSERT policy is wrong and the writer failed SILENTLY, because
--    audit.ts is best-effort and swallows its error. A missing row is the only
--    symptom you will get — there will be no error message anywhere in the UI.
--
-- 5. Existing rows are untouched. Compare against the count taken before this ran:
--
--   select count(*), min(created_at), max(created_at)
--     from public.dm_diligence_audit_log;
--
-- ============================================================================
-- ROLLBACK — restores 0098's policy exactly, and the privileges with it.
-- ============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS dm_diligence_audit_log_select ON public.dm_diligence_audit_log;
-- DROP POLICY IF EXISTS dm_diligence_audit_log_insert ON public.dm_diligence_audit_log;
-- CREATE POLICY dm_diligence_audit_log_all ON public.dm_diligence_audit_log
--   FOR ALL USING (true) WITH CHECK (true);
-- GRANT UPDATE, DELETE ON public.dm_diligence_audit_log TO authenticated;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
--
-- (TRUNCATE is deliberately NOT re-granted: the 2026-08-20 schema-wide revoke
--  removed it from authenticated everywhere, and restoring it here alone would
--  make this table an exception to a change that was applied on purpose.)
-- ============================================================================
