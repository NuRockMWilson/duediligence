-- ============================================================================
-- REMINDER DIGEST — per-user cadence, and a write path the cron can actually use
-- ============================================================================
-- Michael runs this. Nobody else.
--
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS: THE FEATURE WAS BUILT, THEN DISABLED, AND COULD NOT WORK
-- ----------------------------------------------------------------------------
-- /api/cron/diligence-digest already groups outstanding required items by
-- assignee and notifies each person. It was disabled on 2026-09-01 because:
--
--   * Vercel Cron sends no cookies, so createClient() in that route yields the
--     `anon` role, and anon writes were revoked schema-wide on 2026-08-08. Every
--     insert it attempted was refused.
--   * It reported ok:true with a count of assignees it INTENDED to notify, so it
--     claimed success while posting nothing, for an unknown period.
--   * dm_notifications holds exactly ONE row in the whole platform, a pm_handoff
--     from 2026-05-28. Nothing digest-shaped has ever been delivered.
--
-- It was disabled rather than fixed because there was no evidence anyone wanted
-- it. Michael has now asked for exactly this, so that evidence exists.
--
-- ============================================================================
-- THE SECURITY PROBLEM, AND WHY THE OBVIOUS FIX IS WRONG
-- ============================================================================
-- The cron runs as `anon`. To email someone it needs their address from
-- app_users, whose SELECT policy is {authenticated} — so anon cannot even READ
-- what it needs, let alone write.
--
-- A service_role key is the WRONG answer. There is no service-role client in any
-- of the three NuRock apps, which is precisely why RLS is the entire access
-- control model. Introducing the first bypass for the least critical feature
-- would undo that.
--
-- So: a SECURITY DEFINER function, which is the pattern 0079 already uses
-- (app_can, app_is_org_admin) — it runs with the definer's rights and computes
-- everything internally.
--
-- *** BUT A DEFINER FUNCTION GRANTED TO anon IS A PUBLIC ENDPOINT. ***
-- The anon key ships to every browser. A bare app_diligence_due_digests() with
-- EXECUTE to anon would let ANYONE enumerate every NuRock user's email address
-- and outstanding workload. That is a worse leak than the feature is worth, and
-- it is exactly the shape of the unguarded nudgeDiligenceAssignee action that
-- this program already found and closed.
--
-- THE FIX: the function takes a SECRET and verifies it against a table that
-- nothing else can read. dm_cron_secrets has RLS enabled and NO POLICIES and NO
-- GRANTS, so it is unreachable by anon and by authenticated alike — only a
-- SECURITY DEFINER function can see it. The caller must present the secret,
-- which lives in the CRON_SECRET env var the route already checks.
--
-- AND IT TAKES NO RECIPIENT, SUBJECT OR BODY FROM THE CALLER, which the
-- disabled route's own note demanded. Everything is computed from deal state.
-- A caller who knows the secret can trigger a digest; it cannot direct one.
--
-- ============================================================================
-- TWO FUNCTIONS, NOT ONE, AND THAT IS THE POINT
-- ============================================================================
-- app_diligence_due_digests()      -> returns who is due and what to tell them
-- app_diligence_mark_digest_sent() -> records that it actually went out
--
-- A single claim-and-return function would mark people as notified BEFORE the
-- email was accepted, so a Resend failure would silently skip that person until
-- the next interval. Given this feature's history — reporting success while
-- delivering nothing for months — the one thing it must not do is lose a send
-- and believe it happened. Two calls cost a round trip and make the record match
-- reality.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.dm_diligence_deal_items') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: dm_diligence_deal_items missing. Apply 0081 first.';
  END IF;
  IF to_regclass('public.app_users') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: app_users missing.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Per-user cadence. OPT-IN: no row means no email.
-- ----------------------------------------------------------------------------
-- Opt-in rather than opt-out deliberately. An opt-out default would start
-- emailing every assignee the moment Resend is configured, which is how a
-- reminder feature becomes the thing people filter to junk in week one.
CREATE TABLE IF NOT EXISTS dm_diligence_reminder_prefs (
  user_id      uuid PRIMARY KEY,
  cadence      text NOT NULL DEFAULT 'off'
                 CHECK (cadence IN ('off','daily','weekly','monthly')),
  -- 'mine' = only items where I am the assignee or the responsible party.
  -- 'all'  = the whole list's current status.
  -- Michael asked for both: "a current status of the list, or items that are
  -- assigned to them that have not been completed".
  scope        text NOT NULL DEFAULT 'mine'
                 CHECK (scope IN ('mine','all')),
  last_sent_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dm_diligence_reminder_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_diligence_reminder_prefs_own ON dm_diligence_reminder_prefs;
-- OWN ROW ONLY, and org admins for support. A reminder preference is personal;
-- there is no reason for one user to read or change another's.
CREATE POLICY dm_diligence_reminder_prefs_own
  ON dm_diligence_reminder_prefs
  FOR ALL TO authenticated
  USING      (user_id = auth.uid() OR app_is_org_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR app_is_org_admin(auth.uid()));

REVOKE ALL ON public.dm_diligence_reminder_prefs FROM anon;
REVOKE ALL ON public.dm_diligence_reminder_prefs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.dm_diligence_reminder_prefs TO authenticated;

DROP TRIGGER IF EXISTS trg_ddrp_updated_at ON dm_diligence_reminder_prefs;
CREATE TRIGGER trg_ddrp_updated_at
  BEFORE UPDATE ON dm_diligence_reminder_prefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. The secret store. RLS ON, NO POLICIES, NO GRANTS — definer-only.
-- ----------------------------------------------------------------------------
-- Not a typo and not an oversight: a table with row security enabled and no
-- policy denies everyone, and with no grants it is not even reachable. Only a
-- SECURITY DEFINER function, which bypasses both, can read it. That is what
-- makes the digest RPC safe to grant to anon.
CREATE TABLE IF NOT EXISTS dm_cron_secrets (
  name       text PRIMARY KEY,
  secret     text NOT NULL CHECK (length(secret) >= 16),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dm_cron_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_cron_secrets FROM anon;
REVOKE ALL ON public.dm_cron_secrets FROM authenticated;

COMMENT ON TABLE public.dm_cron_secrets IS
  'Shared secrets for unauthenticated cron routes. RLS enabled with NO policies '
  'and NO grants, so it is unreachable by anon and authenticated alike — only a '
  'SECURITY DEFINER function can read it. Michael inserts the digest secret by '
  'hand, matching the CRON_SECRET env var.';

-- ----------------------------------------------------------------------------
-- 3. Who is due, and what to tell them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_diligence_due_digests(p_secret text)
RETURNS TABLE (
  user_id           uuid,
  email             text,
  display_name      text,
  scope             text,
  outstanding_total int,
  overdue_total     int,
  deal_count        int,
  deal_names        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected text;
BEGIN
  SELECT s.secret INTO v_expected FROM dm_cron_secrets s WHERE s.name = 'diligence_digest';
  -- No secret configured means the feature is not set up. Refusing is the safe
  -- reading: a missing secret must never mean "no check required".
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'Digest secret is not configured.';
  END IF;
  IF p_secret IS NULL OR p_secret <> v_expected THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  RETURN QUERY
  WITH outstanding AS (
    SELECT di.deal_id,
           di.assignee_user_id,
           di.responsible_user_id,
           di.due_date
      FROM dm_diligence_deal_items di
     WHERE di.is_required
       AND di.status IN ('not_started','in_progress','submitted')
  ),
  -- A person is interested in an item if they are working it OR they owe it.
  -- Both, because those are different questions (see the responsible_party
  -- migration) and a reminder that ignored either would miss real work.
  per_user AS (
    SELECT u.uid, o.deal_id, o.due_date
      FROM outstanding o
      CROSS JOIN LATERAL (
        SELECT o.assignee_user_id AS uid WHERE o.assignee_user_id IS NOT NULL
        UNION
        SELECT o.responsible_user_id AS uid WHERE o.responsible_user_id IS NOT NULL
      ) u
  ),
  agg AS (
    SELECT pu.uid,
           count(*)::int AS outstanding_total,
           count(*) FILTER (
             WHERE pu.due_date IS NOT NULL AND pu.due_date < current_date
           )::int AS overdue_total,
           count(DISTINCT pu.deal_id)::int AS deal_count,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS deal_names
      FROM per_user pu
      LEFT JOIN deals d ON d.id = pu.deal_id
     GROUP BY pu.uid
  )
  SELECT a.uid,
         au.email,
         au.display_name,
         p.scope,
         a.outstanding_total,
         a.overdue_total,
         a.deal_count,
         a.deal_names
    FROM agg a
    JOIN dm_diligence_reminder_prefs p ON p.user_id = a.uid
    JOIN app_users au ON au.user_id = a.uid
   WHERE p.cadence <> 'off'
     AND au.email IS NOT NULL
     -- Cadence: never sent, or the interval has elapsed. Compared against
     -- last_sent_at rather than a schedule, so a missed cron run catches up
     -- instead of skipping a person's turn entirely.
     AND (
       p.last_sent_at IS NULL
       OR (p.cadence = 'daily'   AND p.last_sent_at < now() - interval '20 hours')
       OR (p.cadence = 'weekly'  AND p.last_sent_at < now() - interval '6 days')
       OR (p.cadence = 'monthly' AND p.last_sent_at < now() - interval '27 days')
     );
END $$;

-- ----------------------------------------------------------------------------
-- 4. Record that it actually went out.
-- ----------------------------------------------------------------------------
-- Called ONLY after the email is accepted. See the header: a single
-- claim-and-return would mark someone notified before delivery, so a Resend
-- failure would silently skip them until the next interval — which is the exact
-- failure mode this feature already had for months.
CREATE OR REPLACE FUNCTION app_diligence_mark_digest_sent(
  p_secret   text,
  p_user_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected text;
  v_count    int;
BEGIN
  SELECT s.secret INTO v_expected FROM dm_cron_secrets s WHERE s.name = 'diligence_digest';
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'Digest secret is not configured.';
  END IF;
  IF p_secret IS NULL OR p_secret <> v_expected THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE dm_diligence_reminder_prefs
     SET last_sent_at = now(), updated_at = now()
   WHERE user_id = ANY(p_user_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- EXECUTE to anon, because the cron has no session. Safe only because both
-- functions verify the secret first and neither accepts a recipient, subject or
-- body from the caller.
REVOKE ALL ON FUNCTION app_diligence_due_digests(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_diligence_mark_digest_sent(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_diligence_due_digests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_diligence_mark_digest_sent(text, uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- MICHAEL: TWO THINGS TO DO AFTER THIS RUNS
-- ============================================================================
-- 1. Store the digest secret. Use the SAME value as the CRON_SECRET env var, and
--    make it long — the CHECK requires at least 16 characters:
--
--      INSERT INTO dm_cron_secrets (name, secret)
--      VALUES ('diligence_digest', '<paste the CRON_SECRET value here>')
--      ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
--
--    Nothing can read that table except the two functions above, so the value is
--    not exposed to the app or to any browser.
--
-- 2. Set the Resend env vars when IT finishes the domain (RESEND_API_KEY,
--    RESEND_FROM). Until then the digest computes correctly, records nothing as
--    sent, and reports honestly that email is unconfigured — it does not pretend.
-- ============================================================================
