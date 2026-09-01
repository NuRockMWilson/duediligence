-- ============================================================================
-- dm_diligence_signoffs — replace the unconditional policy with a scoped pair
-- ============================================================================
-- TIER 1 of the 2026-08-31 privilege review. This table is the diligence
-- module's SOLE STATUS AUTHORITY: nothing else determines whether an item is
-- approved. It shipped with 0083's `FOR ALL USING (true) WITH CHECK (true)`,
-- and the live measurement confirms `authenticated` holds INSERT + UPDATE +
-- DELETE. So today any authenticated user can create, alter, or delete any
-- sign-off on any deal. The append-only audit log added in 20260820 records
-- such a change faithfully — it cannot prevent one.
--
-- ---------------------------------------------------------------------------
-- WHAT THE APPLICATION ACTUALLY DOES — the constraint set this policy must fit
-- ---------------------------------------------------------------------------
-- All three write paths live in one file,
-- src/app/(app)/deals/[dealId]/diligence/actions.ts, and all three use the
-- anon-key server client (NEXT_PUBLIC_SUPABASE_ANON_KEY + the caller's cookie
-- session). There is no service-role client in any of the four repos, so RLS is
-- the whole control surface.
--
--   W1  :791  UPSERT on (deal_item_id, role)   guard: `if (!user)` only
--   W2  :809  DELETE, downstream invalidation  guard: same
--   W3  :850  DELETE, clearDiligenceSignoff    guard: NONE — not even !user
--
-- Three facts here decide the shape of the policy, and getting any of them
-- wrong breaks the sign-off chain:
--
-- 1. SIGN-OFFS ARE LEGITIMATELY WRITTEN AND DELETED BY SOMEONE OTHER THAN THE
--    SIGNER. An upstream re-decision deletes downstream rows authored by other
--    people (W2), and clearDiligenceSignoff clears a role plus everything after
--    it (W3). So `actor_user_id = auth.uid()` MUST NOT appear in USING. It is
--    safe — and free — in WITH CHECK, because W1 already sets actor_user_id to
--    the caller.
--
-- 2. THE UI GATES ON devmgmt, NOT diligence. item-drawer.tsx:765 reads
--    `role === "approver" ? canApprove : canEdit`, and page.tsx:38-45 computes
--    both from hasPermission(access, "devmgmt", ...). Existing staff enter this
--    app on a devmgmt role — layout.tsx:28-31 admits devmgmt OR diligence OR
--    org admin. Keying this policy on 'diligence' alone would lock out most of
--    the team. Both module names are therefore accepted.
--
-- 3. edit OR approve, NOT approve alone. Only the approver row needs `approve`;
--    preparer and reviewer rows are edit-level by the app's own rule. Requiring
--    approve would break two-thirds of legitimate sign-offs for every
--    contributor. The per-role distinction is deliberately NOT expressed here:
--    W2's cross-role DELETE means USING must admit an edit-only user removing an
--    approver row anyway, so a role-aware WITH CHECK would add a predicate
--    without narrowing the door.
--
-- ---------------------------------------------------------------------------
-- DEAL SCOPING — via deal_item_id, never via deal_id
-- ---------------------------------------------------------------------------
-- dm_diligence_signoffs.deal_id is `text NOT NULL` with NO foreign key, and W1
-- takes it straight from client input. It is not trustworthy. The real FK is
-- deal_item_id -> dm_diligence_deal_items(id), and THAT table carries
-- `deal_id text NOT NULL REFERENCES deals(id)` (0081:145). All deal scoping
-- routes through the item.
--
-- The deal predicate mirrors 0097's `deals` policy exactly — owner OR org admin
-- OR a deal_access grant. That equivalence is what makes this safe rather than a
-- new lockout: IF A USER CANNOT PASS THIS CHECK, THEY CANNOT SEE THE DEAL AT
-- ALL, because `deals_select` already enforces the same three-way test. This
-- adds no restriction that is not already in force one table up.
--
-- Live-verified before writing this file: 0097 IS applied (deals_select carries
-- the deal_access EXISTS clause), and app_can/app_is_org_admin are SECURITY
-- DEFINER and working (0079 applied — the dm_* core's app_can-keyed policies
-- function without the app_user_roles recursion 0077's header warns about).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- * DELETE is NOT revoked. Unlike the audit log, two live paths delete: W2's
--   downstream invalidation and W3's user-facing Undo button. Revoking it would
--   break both. TRUNCATE has no caller and is not governed by RLS, so it goes.
-- * Reads stay open. USING (true) on SELECT matches the audit log and every
--   other diligence table; the checklist page and the packet export both read
--   sign-offs across a deal. Narrowing reads is a separate decision.
-- * It does not fix W3's missing authorization guard in application code — but
--   it does make RLS the guard, which is a genuine improvement over nothing.
--   The app-side fix is still owed.
-- * It cannot touch the ON DELETE CASCADE from dm_diligence_deal_items.
--   PostgreSQL referential actions bypass row security and do not check the
--   caller's DELETE privilege on the child, so deleting a deal still cascades.
--   That is correct behaviour; do not size the policy around it.
-- * It does not express the sign-off chain's sequencing, document gates, or
--   status derivation. None of that is expressible in RLS. This answers only
--   the coarse question: may this person write sign-offs on this deal at all.
--
-- ---------------------------------------------------------------------------
-- RUN THE PRE-FLIGHT FIRST. The failure mode here is SILENT.
-- ---------------------------------------------------------------------------
-- W2's delete is `await sb...` with no error handling, so if the predicate is
-- wrong, downstream invalidation fails without a message and the chain desyncs
-- from dm_diligence_deal_items.status — the sole status authority corrupting
-- itself quietly. That is worse than a visible outage, so confirm the predicate
-- evaluates TRUE for real users BEFORE swapping the policy. Pre-flight is at the
-- bottom of this file.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS dm_diligence_signoffs_all ON public.dm_diligence_signoffs;

-- Reads: any signed-in user, matching every other diligence table.
DROP POLICY IF EXISTS dm_diligence_signoffs_select ON public.dm_diligence_signoffs;
CREATE POLICY dm_diligence_signoffs_select ON public.dm_diligence_signoffs
  FOR SELECT TO authenticated
  USING (true);

-- Writes: module permission AND deal reachability.
DROP POLICY IF EXISTS dm_diligence_signoffs_write ON public.dm_diligence_signoffs;
CREATE POLICY dm_diligence_signoffs_write ON public.dm_diligence_signoffs
  FOR ALL TO authenticated
  USING (
    (   app_can('diligence','edit')
     OR app_can('devmgmt','edit')
     OR app_can('diligence','approve')
     OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    AND EXISTS (
      SELECT 1
        FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_signoffs.deal_item_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id
                            AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id
                            AND d.owner_id = auth.uid()::text)))
  )
  WITH CHECK (
    (   app_can('diligence','edit')
     OR app_can('devmgmt','edit')
     OR app_can('diligence','approve')
     OR app_can('devmgmt','approve')
     OR app_is_org_admin(auth.uid()))
    -- Free integrity win: stops forged attribution. W1 already sets this to the
    -- caller, so no legitimate write is affected. NOT in USING — see note 1.
    AND actor_user_id = auth.uid()
    -- Substitutes for the missing FK: the client-supplied deal_id must agree
    -- with the item's real deal.
    AND EXISTS (
      SELECT 1
        FROM public.dm_diligence_deal_items di
       WHERE di.id = dm_diligence_signoffs.deal_item_id
         AND di.deal_id = dm_diligence_signoffs.deal_id
         AND (   app_is_org_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.deal_access da
                          WHERE da.deal_id = di.deal_id
                            AND da.user_id = auth.uid())
              OR EXISTS (SELECT 1 FROM public.deals d
                          WHERE d.id = di.deal_id
                            AND d.owner_id = auth.uid()::text)))
  );

-- Belt, and independent of RLS: TRUNCATE is not governed by row security at all
-- and has no caller anywhere.
REVOKE TRUNCATE ON public.dm_diligence_signoffs FROM authenticated;
REVOKE TRUNCATE ON public.dm_diligence_signoffs FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- PRE-FLIGHT — READ-ONLY. Run this BEFORE the BEGIN block above.
-- ============================================================================
-- Expect `true` in can_write for every person who legitimately signs off. A
-- `false` for anyone real means STOP: they hold neither an edit/approve role in
-- devmgmt or diligence, nor org admin.
--
--   select u.email,
--          u.is_cfo,
--          exists (select 1 from public.app_user_roles r
--                   where r.user_id = u.user_id
--                     and r.module in ('devmgmt','diligence')
--                     and r.role_key in ('contributor','manager','admin')) as has_edit_or_approve,
--          public.app_is_org_admin(u.user_id)                              as org_admin
--     from public.app_users u
--    order by u.email;
--
-- And confirm the deal half is populated, i.e. that deal_access or ownership
-- actually reaches the deals people work:
--
--   select d.id, d.name, d.owner_id,
--          (select count(*) from public.deal_access da where da.deal_id = d.id) as grants
--     from public.deals d
--    where d.stage <> 'dead'
--    order by d.name;
--
-- ============================================================================
-- VERIFICATION — after applying
-- ============================================================================
-- 1. Exactly two policies, no ALL-with-true.
--
--   select policyname, cmd, roles::text,
--          left(coalesce(qual,'(none)'),80)       as using_clause,
--          left(coalesce(with_check,'(none)'),80) as check_clause
--     from pg_policies
--    where schemaname='public' and tablename='dm_diligence_signoffs'
--    order by policyname;
--
-- 2. Privileges: INSERT/UPDATE/DELETE still held (all three are needed),
--    TRUNCATE gone. Expect t,t,t,f.
--
--   select has_table_privilege('authenticated','public.dm_diligence_signoffs','insert')   as ins,
--          has_table_privilege('authenticated','public.dm_diligence_signoffs','update')   as upd,
--          has_table_privilege('authenticated','public.dm_diligence_signoffs','delete')   as del,
--          has_table_privilege('authenticated','public.dm_diligence_signoffs','truncate') as trunc;
--
-- 3. THE FUNCTIONAL TESTS, and they are the ones that matter. In the diligence
--    app, on a deal you can reach:
--      a. Record a preparer sign-off. It must save.
--      b. Record the approver sign-off. It must save.
--      c. Re-decide the preparer item. THE APPROVER ROW MUST DISAPPEAR — this is
--         W2, the cross-actor delete, and it fails SILENTLY if the policy is
--         wrong. Check the drawer after the re-decision; an approver still
--         showing "Approved" above a re-decided preparer is the failure.
--      d. Press Undo on a sign-off (W3). It must clear that role and everything
--         downstream.
--    THE FALSIFYING OBSERVATION, stated in advance: if (c) leaves the approver
--    row in place, roll back immediately — the chain has desynced from
--    dm_diligence_deal_items.status.
--
-- 4. Confirm the audit log still receives events for the above (20260820 made it
--    append-only; its writer is best-effort and swallows errors, so a missing
--    row is the only symptom).
--
-- ============================================================================
-- ROLLBACK — restores 0083's policy exactly
-- ============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS dm_diligence_signoffs_select ON public.dm_diligence_signoffs;
-- DROP POLICY IF EXISTS dm_diligence_signoffs_write  ON public.dm_diligence_signoffs;
-- CREATE POLICY dm_diligence_signoffs_all ON public.dm_diligence_signoffs
--   FOR ALL USING (true) WITH CHECK (true);
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
--
-- (TRUNCATE is deliberately NOT re-granted: nothing has ever used it.)
-- ============================================================================
