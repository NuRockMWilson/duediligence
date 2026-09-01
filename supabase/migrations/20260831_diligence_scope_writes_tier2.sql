-- ============================================================================
-- TIER 2 — per-deal isolation for the diligence module (five tables)
-- ============================================================================
-- The devmgmt core got the careful 0077 pass; the diligence tables were created
-- in 0081 AFTER it and were never added to its list. So the module has NO
-- per-deal isolation at all: measured live 2026-08-31, each of these carries an
-- unconditional `FOR ALL USING (true) WITH CHECK (true)` and `authenticated`
-- holds INSERT + UPDATE + DELETE.
--
--   dm_diligence_deal_items        dm_diligence_documents
--   dm_diligence_deal_templates   dm_diligence_item_documents
--                                 dm_diligence_expected_docs
--
-- Any authenticated user can currently read and write checklist items,
-- documents, template adoptions and expected-doc slots across every deal.
-- dm_diligence_signoffs was scoped separately (20260831_signoffs_scope_rls.sql)
-- and dm_diligence_audit_log is already append-only (20260820).
--
-- ---------------------------------------------------------------------------
-- THE CENTRAL DECISION: READS ARE LEFT EXACTLY AS THEY ARE. ONLY WRITES MOVE.
-- ---------------------------------------------------------------------------
-- Every read-tightening failure mode in this module is SILENT, and three are
-- destructive. Six independent reasons, each verified in code:
--
-- 1. A LIVE anon READER. src/app/api/cron/diligence-digest/route.ts sits OUTSIDE
--    the (app) gate, is scheduled weekly in vercel.json, and calls
--    runDiligenceDigest() -> createClient() with NO cookies, so it queries as
--    `anon`. digest.ts:35 reads dm_diligence_deal_items; digest.ts:43 returns
--    {assigneesNotified: 0} on an empty result and route.ts:27 returns
--    {ok:true}. Adding `TO authenticated`, or any app_can()-keyed read (which is
--    false for anon since auth.uid() is NULL), kills the digest permanently at
--    HTTP 200 with nobody told. It works today only because 0081's policy has no
--    TO clause and this table predates 20260820_default_revoke_anon_select, whose
--    own header notes the pre-existing 61 tables kept their anon SELECT grant.
--    NOTE: the signoffs migration DID use `TO authenticated` on SELECT. That was
--    safe there because nothing anon-side reads signoffs. It is not safe here.
--
-- 2. AN EMPTY READ RENDERS A DEAL 100% READY. diligence-rollup.ts:108-109 --
--    `coveragePct = applicable === 0 ? 100 : ...` and `allClear:
--    outstandingCount === 0`. A locked-out reader is not shown an error or an
--    "unknown"; they are told diligence is FINISHED. That feeds the deal header,
--    the portfolio readiness bar (deals/page.tsx:42) and both exported packet
--    PDFs, which go to lenders and investors.
--
-- 3. VACUOUS COMPLETENESS on the approver gate. actions.ts:765-788 reads the
--    expected-doc slots and proceeds only `if (!slotsErr && slots &&
--    slots.length > 0)`. RLS returns ZERO ROWS rather than an error, so the
--    unfilled-slot check is skipped entirely and the approver approves on one
--    linked document while named slots sit unfilled. The guard was written to
--    fail open for pre-0100 deploys and a restrictive read is indistinguishable
--    from that. The drawer then renders "No slots yet — any one linked document
--    gates approval" (item-drawer.tsx:582-584) — an affirmative statement that
--    is false, with no way for the approver to tell. That is 0100's entire
--    purpose silently reverting to the no-op it replaced.
--
-- 4. FILE DESTRUCTION. unlinkDiligenceDocument (actions.ts:426-446) reads the
--    remaining links to decide whether a document is orphaned. An RLS-emptied
--    read makes it conclude "unreferenced" and DELETE the storage object and the
--    row while other items still link it. No soft delete, no versioning.
--
-- 5. WORKED ITEMS DELETED. unadoptTemplateForDeal
--    (settings/diligence-templates/actions.ts:378-402) probes "does this item
--    have documents?" to build its `touched` exclusion set. An empty read makes
--    document-bearing items look untouched and they are deleted, cascading away
--    their links, slots and sign-offs.
--
-- 6. LIVE REFRESH STOPS. dm_diligence_deal_items is in the supabase_realtime
--    publication (0081:260-270) and realtime evaluates the SUBSCRIBER's SELECT
--    policy, so anyone a restrictive read excludes silently stops receiving
--    teammates' changes.
--
-- Reads are also already bounded one table up: anything the UI can navigate to
-- passes through deals_select (0097), so leaving these open grants no access to
-- a deal a user cannot already reach.
--
-- ---------------------------------------------------------------------------
-- THE CROSS-TABLE INTERACTION WITH THE APPLIED SIGN-OFF POLICY
-- ---------------------------------------------------------------------------
-- 20260831_signoffs_scope_rls.sql's write policy contains
-- `EXISTS (SELECT 1 FROM dm_diligence_deal_items di WHERE di.id = ...)`. Policy
-- subqueries are ordinary subqueries evaluated as the CALLING role, with RLS
-- enforced on every referenced table. So that EXISTS currently always resolves
-- only because dm_diligence_deal_items has USING (true) — the row-visibility
-- half contributes nothing and the check turns entirely on the
-- deal_access/owner/org-admin disjunct.
--
-- Narrowing dm_diligence_deal_items' SELECT would start filtering that scan and
-- could flip the EXISTS to false. The sign-off downstream-invalidation DELETE is
-- a bare `await` with no error check (actions.ts:809-813), so the failure would
-- be exactly the silent chain desync that migration warned about — a stale
-- "Approved" approver row sitting above a re-decided preparer.
--
-- KEEPING THE READ OPEN AVOIDS THIS BY CONSTRUCTION. Before anyone ever narrows
-- it, the invariant to hold is: **the deal_items SELECT predicate must be a
-- superset of the deal-reachability disjunct inside the signoffs EXISTS** — same
-- three-way test, same column, nothing more. Adding a module term (e.g.
-- app_can('diligence','view')) would break it, because a user who passes the
-- signoffs module OR-set on devmgmt/approve but lacks that specific view action
-- becomes invisible to the di scan.
--
-- STILL OWED, and the durable fix: refactor that cross-table EXISTS into a
-- SECURITY DEFINER helper in the 0079 mould (e.g. app_can_reach_deal(text)).
-- It bypasses RLS on what it reads, so the signoffs policy stops depending on
-- this table's policy entirely, and it deduplicates a predicate now written out
-- five times across 0097 and the two 20260831 files. Deliberately NOT done here:
-- inline predicates keep this migration self-contained, textually identical to
-- the already-verified signoffs policy, and independently reviewable per table.
--
-- ---------------------------------------------------------------------------
-- WHY THE WRITE PREDICATES DIFFER BY TABLE
-- ---------------------------------------------------------------------------
-- Three of these carry a REAL foreign key on deal_id and can be scoped directly:
--   dm_diligence_deal_items      deal_id text NOT NULL REFERENCES deals(id)  (0081:145)
--   dm_diligence_deal_templates  deal_id text NOT NULL REFERENCES deals(id)  (0081:125, half the PK)
--   dm_diligence_documents       deal_id text NOT NULL REFERENCES deals(id)  (0081:198)
--
-- Two repeat the sign-off defect — deal_id is unvalidated client input with NO
-- FK — and must route through deal_item_id, with WITH CHECK forcing the two to
-- agree (substituting for the missing constraint):
--   dm_diligence_item_documents  (0081:231-238)
--   dm_diligence_expected_docs   (0100:19-27)
-- Both tables' READS filter on that same untrusted column
-- (diligence.ts:236, :348), which is why the agreement check matters.
--
-- deal_items and deal_templates get TEXTUALLY IDENTICAL policies on purpose:
-- ensureDealDiligenceItems writes both in one call and the template upsert
-- (diligence.ts:131-136) does not capture its error at all, so a divergence
-- would let one write succeed and the other fail with no signal anywhere.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- * Does not revoke DELETE on any table. Each has exactly one live caller:
--   unadoptTemplateForDeal deletes from deal_items (:398) and deal_templates
--   (:351); unlinkDiligenceDocument deletes from documents (:445) and
--   item_documents (:405); removeDiligenceExpectedDoc deletes slots (:545).
-- * Does not revoke UPDATE on dm_diligence_documents. No caller exists today,
--   but sync_status / sharepoint_path are wiring for the planned SharePoint
--   sync writer, which must satisfy the same predicate when it lands.
-- * Does not touch the org-global catalog — nurock_diligence_templates and
--   nurock_diligence_items have no deal_id and are shared by construction. The
--   `nurock_` prefix is this module's reliable signal for org-global; `dm_` means
--   deal-scoped. Those are Tier 3.
-- * Does not add per-action guards in application code. Nearly every write site
--   in this module has NO authorization check — several have not even a
--   signed-in check — so these policies are currently the only control, and a
--   denial will surface as a raw Postgres error rather than a permission
--   message. Brief 07 Part E covers the app side.
-- * Cannot touch referential actions. deals ON DELETE CASCADE reaches all five
--   tables and is not subject to row security; deleting a deal still clears them
--   and still leaves bucket objects orphaned. Do not size these policies around
--   that.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A P0 THIS MIGRATION DOES NOT FIX — flagged so it is not forgotten
-- ---------------------------------------------------------------------------
-- getDiligenceDocSignedUrl (actions.ts:591-604) is an unguarded server action
-- that takes an ARBITRARY filePath and returns a signed download URL. No auth
-- check, no deal check, no verification that the path maps to a row the caller
-- may read. Under the Supabase provider, storage.objects RLS is the only
-- backstop — and there are ZERO storage.objects policy statements in any
-- migration in any repo, so that policy set is dashboard-managed and
-- unmeasurable from code. Under the SharePoint provider (app-only Graph
-- credentials with Sites.ReadWrite.All) it is a COMPLETE BYPASS: any
-- authenticated user can mint a download URL for any path under the root folder.
-- Table policies are irrelevant to it. Measure the bucket policies and fix that
-- action separately.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop only the unconditional FOR ALL policies, by catalog lookup rather
--    than by guessed name. dm_diligence_expected_docs' separate _select policy
--    is intentionally left alone by this loop (cmd = 'SELECT', not 'ALL').
-- ---------------------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd = 'ALL'
       AND tablename IN ('dm_diligence_deal_items',
                         'dm_diligence_deal_templates',
                         'dm_diligence_documents',
                         'dm_diligence_item_documents',
                         'dm_diligence_expected_docs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Reads. USING (true) and NO `TO` clause, preserving today's role coverage
--    exactly — including the anon cron's access to deal_items. This is not an
--    oversight; see reason 1 in the header.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS dm_diligence_deal_items_select ON public.dm_diligence_deal_items;
CREATE POLICY dm_diligence_deal_items_select ON public.dm_diligence_deal_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS dm_diligence_deal_templates_select ON public.dm_diligence_deal_templates;
CREATE POLICY dm_diligence_deal_templates_select ON public.dm_diligence_deal_templates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS dm_diligence_documents_select ON public.dm_diligence_documents;
CREATE POLICY dm_diligence_documents_select ON public.dm_diligence_documents
  FOR SELECT USING (true);

DROP POLICY IF EXISTS dm_diligence_item_documents_select ON public.dm_diligence_item_documents;
CREATE POLICY dm_diligence_item_documents_select ON public.dm_diligence_item_documents
  FOR SELECT USING (true);

-- expected_docs already has its own _select from 0100:36-38; recreate it
-- identically so all five tables end in the same shape.
DROP POLICY IF EXISTS dm_diligence_expected_docs_select ON public.dm_diligence_expected_docs;
CREATE POLICY dm_diligence_expected_docs_select ON public.dm_diligence_expected_docs
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- 3. Writes — direct deal_id scoping (real FK on all three)
--    The module OR-set is copied verbatim from the applied signoffs policy:
--    diligence OR devmgmt, edit OR approve, or org admin. The UI gates on
--    devmgmt (diligence/page.tsx:38-45), so keying on diligence alone would
--    lock out most staff. The deal half mirrors deals_select (0097:74-81), so a
--    user who fails it cannot see the deal at all.
-- ---------------------------------------------------------------------------
CREATE POLICY dm_diligence_deal_items_write ON public.dm_diligence_deal_items
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_deal_items.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_deal_items.deal_id
                       AND d.owner_id = auth.uid()::text))
  )
  WITH CHECK (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_deal_items.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_deal_items.deal_id
                       AND d.owner_id = auth.uid()::text))
  );

-- Textually identical to deal_items — see the header on why divergence is unsafe.
CREATE POLICY dm_diligence_deal_templates_write ON public.dm_diligence_deal_templates
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_deal_templates.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_deal_templates.deal_id
                       AND d.owner_id = auth.uid()::text))
  )
  WITH CHECK (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_deal_templates.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_deal_templates.deal_id
                       AND d.owner_id = auth.uid()::text))
  );

CREATE POLICY dm_diligence_documents_write ON public.dm_diligence_documents
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_documents.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_documents.deal_id
                       AND d.owner_id = auth.uid()::text))
  )
  WITH CHECK (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND (   app_is_org_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.deal_access da
                     WHERE da.deal_id = dm_diligence_documents.deal_id
                       AND da.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = dm_diligence_documents.deal_id
                       AND d.owner_id = auth.uid()::text))
  );

-- ---------------------------------------------------------------------------
-- 4. Writes — routed through deal_item_id (deal_id has NO FK on these two and
--    is unvalidated client input). WITH CHECK additionally forces the client's
--    deal_id to agree with the item's real deal, substituting for the missing
--    constraint — the same technique as signoffs_scope_rls.sql:148.
-- ---------------------------------------------------------------------------
CREATE POLICY dm_diligence_item_documents_write ON public.dm_diligence_item_documents
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_item_documents.deal_item_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id AND d.owner_id = auth.uid()::text)))
  )
  WITH CHECK (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_item_documents.deal_item_id
         AND di.deal_id = dm_diligence_item_documents.deal_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id AND d.owner_id = auth.uid()::text)))
  );

CREATE POLICY dm_diligence_expected_docs_write ON public.dm_diligence_expected_docs
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_expected_docs.deal_item_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id AND d.owner_id = auth.uid()::text)))
  )
  WITH CHECK (
    (   app_can('diligence','edit')    OR app_can('devmgmt','edit')
     OR app_can('diligence','approve') OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_expected_docs.deal_item_id
         AND di.deal_id = dm_diligence_expected_docs.deal_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id AND d.owner_id = auth.uid()::text)))
  );

-- ---------------------------------------------------------------------------
-- 5. Privileges. TRUNCATE is a table privilege row security does NOT filter and
--    has no caller anywhere in any repo. UPDATE on item_documents likewise has
--    no caller — its "upsert" is ON CONFLICT DO NOTHING, which needs only INSERT.
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE ON public.dm_diligence_deal_items       FROM authenticated, anon;
REVOKE TRUNCATE ON public.dm_diligence_deal_templates   FROM authenticated, anon;
REVOKE TRUNCATE ON public.dm_diligence_documents        FROM authenticated, anon;
REVOKE TRUNCATE ON public.dm_diligence_item_documents   FROM authenticated, anon;
REVOKE TRUNCATE ON public.dm_diligence_expected_docs    FROM authenticated, anon;

REVOKE UPDATE ON public.dm_diligence_item_documents FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- PRE-FLIGHT — read-only, run BEFORE the BEGIN block
-- ============================================================================
-- 1. Everyone who works a checklist must pass the module OR-set. A real user
--    returning false loses write access to diligence entirely.
--
--   select u.email,
--          exists (select 1 from public.app_user_roles r
--                   where r.user_id = u.user_id
--                     and r.module in ('devmgmt','diligence')
--                     and r.role_key in ('contributor','manager','admin')) as has_edit_or_approve,
--          public.app_is_org_admin(u.user_id)                              as org_admin
--     from public.app_users u
--    order by u.email;
--
-- 2. And the deal half must actually reach the deals people work. A deal with no
--    grants and an owner_id nobody matches is a deal whose checklist becomes
--    read-only for everyone except org admins.
--
--   select d.id, d.name, d.owner_id,
--          (select count(*) from public.deal_access da where da.deal_id = d.id) as grants
--     from public.deals d
--    where d.stage <> 'dead'
--    order by d.name;
--
-- 3. Confirm the anon cron's read is currently working, so you can tell
--    afterwards whether anything changed:
--
--   select has_table_privilege('anon','public.dm_diligence_deal_items','select') as anon_can_read;
--
--   Expect true. This migration does not change it — that is the point.
--
-- ============================================================================
-- VERIFICATION — after applying
-- ============================================================================
-- 1. Shape: two policies per table, the select one with NO role restriction
--    (roles = {public}) and the write one TO authenticated, and no ALL policy
--    with a `true` qualifier left anywhere.
--
--   select tablename, policyname, cmd, roles::text,
--          left(coalesce(qual,'(none)'),50) as using_clause
--     from pg_policies
--    where schemaname='public' and tablename like 'dm_diligence%'
--    order by tablename, policyname;
--
-- 2. Privileges: TRUNCATE gone on all five, UPDATE gone on item_documents only,
--    DELETE retained everywhere, and anon SELECT on deal_items UNCHANGED.
--
--   select c.relname,
--          has_table_privilege('authenticated', c.oid, 'insert')   as ins,
--          has_table_privilege('authenticated', c.oid, 'update')   as upd,
--          has_table_privilege('authenticated', c.oid, 'delete')   as del,
--          has_table_privilege('authenticated', c.oid, 'truncate') as trunc,
--          has_table_privilege('anon',          c.oid, 'select')   as anon_sel
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname='public' and c.relname like 'dm_diligence%'
--    order by c.relname;
--
-- 3. FUNCTIONAL — in the diligence app, on a deal you can reach:
--      a. Open a deal's checklist. Items must render (this exercises the lazy
--         ensureDealDiligenceItems INSERT on both deal_items AND
--         deal_templates — the write most likely to fail invisibly, since the
--         template upsert captures no error).
--      b. Change an item's status, assignee, due date and notes. All must save.
--      c. Upload a document to an item, then unlink it. Both must work.
--      d. Add an expected-doc slot, assign a document to it, then remove it.
--      e. Record a preparer sign-off, then the approver sign-off, then re-decide
--         the preparer — THE APPROVER ROW MUST STILL DISAPPEAR. This re-tests the
--         already-applied signoffs policy against the new deal_items policy,
--         which is the interaction described in the header.
--      f. Adopt a template packet and then remove it.
--
--    THE FALSIFYING OBSERVATION, stated in advance: if (a) shows an EMPTY
--    checklist reading "No items match these filters", the lazy-instantiation
--    write was denied — that empty state is the only one this UI has and it
--    blames the filters. Roll back rather than debug forward.
--
--    SECOND FALSIFYING OBSERVATION: if (e) leaves the approver still showing
--    "Approved" above a re-decided preparer, the cross-table EXISTS has broken.
--    Roll back.
--
-- 4. Then check the digest did not break. Either wait for Monday, or hit
--    /api/cron/diligence-digest with the CRON_SECRET bearer and confirm
--    assigneesNotified is NON-ZERO. A response of {ok:true, assigneesNotified:0}
--    is the silent-failure signature.
--
-- ============================================================================
-- ROLLBACK — restores 0081/0100's unconditional policies
-- ============================================================================
-- BEGIN;
-- DO $rb$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY['dm_diligence_deal_items','dm_diligence_deal_templates',
--                            'dm_diligence_documents','dm_diligence_item_documents',
--                            'dm_diligence_expected_docs'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write',  t);
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
--                    t || '_all', t);
--   END LOOP;
-- END $rb$;
-- GRANT UPDATE ON public.dm_diligence_item_documents TO authenticated;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
--
-- (TRUNCATE is deliberately NOT re-granted on any of the five.)
-- ============================================================================
