# Template-owned item groups — design (ASK 6, and the schema ASK 2 was waiting on)

**Status:** `supabase/migrations/20260903_diligence_item_groups.sql` — **APPLIED and VERIFIED**
2026-09-04 (31 assertions across four scripts, 0 leftover fixtures). The UI shipped in `897e21c`
and the importer in `28d18b4`, so ASK 6 (a)–(f) is complete and live.
**Phase 2 (ASK 2 entities):** `supabase/migrations/20260904_diligence_entities.sql` — written, **not
yet run**. See §7, which now records the decisions rather than the open questions.
**Verifiers:** groups — four scripts in `scripts/diagnostics/20260903_verify_groups_*`; entities —
two in `20260904_verify_entities_*`. Script 1 of each is catalog-only and read-only; the rest create
throwaway fixtures and end by RAISING, which is what rolls them back. Every line must read `PASS`.
The groups verifier was split from one 300-line file after it failed twice on plpgsql errors no
checker available here can see — see §6.
**Author:** Claude, 2026-09-03. Michael runs all SQL; nobody else.

---

## 1. The problem, as measured

The add/edit item form offers exactly **15 category options and nothing else**. They are the canonical
NuRock 59-item checklist's own headers, hardcoded in `src/lib/diligence/categories.ts`. There is no
free-text category field and no create-new-category control — the form's only inputs are *Item title*
and *Code (optional)*.

The PNC DD Checklist is structured like this:

- **12 numbered top-level sections**
- a **second level** beneath them — section 2 *Real Estate* → Title / Survey / Flood / Site Control /
  Zoning; section 7 *Construction Documents* → eight subsections a–h
- a **third, per-entity level** under section 1 — partnership; GP tier b/b1/b2/b3/b3.1; developers
  c1–c3; sponsor; guarantors i–iii
- **329 items** in total

**None of PNC's 12 section names exist in the 15-category list.** So importing that file forces all
329 items into NuRock categories that do not describe the lender's structure, and the packet renders
as a flat list. It is also the concrete reason the importer can only map the item-title column: the
*Section* column has nowhere to land.

## 2. What this is not

**Coverage does not change.** Coverage is computed from `nurock_diligence_crosswalk`: a mapped
external item stays *virtual* and its coverage flows through the canonical item that satisfies it.
Groups are **organisational** — how a packet is laid out for a reader.

Wiring presentation into the coverage denominator would create one quantity computed two ways, which
is this platform's most expensive recurring defect. `category` keeps its current meaning: the
canonical LIHTC grouping that drives the standard checklist's own headers.

## 3. The schema

### `nurock_diligence_item_groups`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `template_id` | uuid NOT NULL → templates | `ON DELETE CASCADE` |
| `parent_group_id` | uuid → self | NULL = top-level section; `ON DELETE CASCADE` |
| `label` | text NOT NULL | the financier's **own** wording, free text, never validated against the 15 |
| `code` | text | the financier's own numbering verbatim: `2`, `7.a`, `b3.1`, `iii` — kept as text and **never parsed** |
| `depth` | int NOT NULL | trigger-maintained, `CHECK (depth BETWEEN 0 AND 2)` |
| `sort_order` | int NOT NULL | **deliberately not unique** — see §4 |
| `is_entity_parameterized` | boolean NOT NULL | ASK 2 hook, read by nothing yet |
| `entity_role` | text | ditto; coherence enforced by CHECK |
| `notes` | text | |

### `nurock_diligence_items.group_id`

Nullable, `→ groups(id) ON DELETE SET NULL`.

**`SET NULL`, not `CASCADE`.** Deleting a section must never delete the lender's requirements. Items
fall back to ungrouped and stay visible, which is recoverable; silently destroying checklist rows is
not.

Every existing row stays `NULL`, so the canonical 59-item checklist and both existing imports render
exactly as they do today. **Grouping is opt-in per template.**

## 4. Three decisions worth arguing with

**(a) No second ordering source.** Item order stays `item_number`. A grouped checklist orders by
*(group position, item_number)*. A per-group position column would be a second source of truth for
one fact and the two would drift — the same defect family as everything else in this program.

**(b) Group `sort_order` is NOT unique, on purpose.** `nurock_diligence_items` has an inline
`UNIQUE (template_id, item_number)`, which is non-deferrable, which is why reordering an item needs a
three-step park-and-swap through a temporary negative number. That constraint bought correctness we
were already getting from the application and cost a whole class of collision. Groups don't repeat
the mistake: reordering a group is one plain `UPDATE`. Ties break on `label`, so ordering stays
deterministic.

**(c) Max three levels, enforced by trigger.** ASK 6 asks for at least two, three if entity blocks
are groups. The ceiling is a trigger rather than a generated column because depth is recursive and a
generated column may not read other rows. The same trigger refuses **cycles** — without it a caller
can re-parent a group under its own descendant and every recursive read of that template loops
forever. A rendering path that can hang is worse than a rejected write.

## 5. Grants are spelled out, and here is why

On 2026-09-03 every attempted hard delete of a checklist item failed with
`permission denied for table nurock_diligence_items` — as **org admin**, in a session where INSERT
and UPDATE had just succeeded seconds earlier. Cause: `0081` created
`nurock_diligence_items_all ... FOR ALL USING (true)` and **no GRANT anywhere in the migration
history**.

**A policy never confers a privilege.** A permissive `FOR ALL` policy is inert without a table-level
grant. RLS filters rows; a GRANT decides whether the table is reachable at all. `permission denied
for table X` is *always* a privilege and *never* a policy — a policy denial presents as zero rows and
a silent no-op.

So the new table gets **both** an explicit policy and an explicit grant, `anon` is revoked, and
TRUNCATE is revoked because row security does not filter it. The write predicate mirrors
`assertDiligenceCan()` — diligence role OR devmgmt role OR org admin — so the app and the database
agree rather than disagreeing in ways that surface only as a blank screen.

The migration also makes the **existing** `nurock_diligence_items` grant explicit
(`SELECT, INSERT, UPDATE`, no DELETE, `anon` revoked). It deliberately does **not** add DELETE: the
app no longer deletes catalog items at all — removal is `is_active = false` — which is what `0081`'s
own comment requires so live deal tracking can never be orphaned.

## 6. What I could not verify, stated plainly

**The migration's syntax is proven. Its behaviour is not.**

- `pglast` v8.4 parses both files as PostgreSQL. But `pglast` treats dollar-quoted bodies as opaque
  strings, so it validates **none** of the plpgsql. Reviewing after it passed, I found a real
  structural error in the verifier — a nested block written `BEGIN DECLARE … BEGIN … END; END`, where
  plpgsql requires `DECLARE` before its own `BEGIN` — and fixed it. A separate structural check now
  confirms every block is balanced with no `BEGIN DECLARE`.
- I could **not execute** either file. The embedded PostgreSQL 17.10 in `nurock-underwriting` starts
  its postmaster but every forked backend dies with Windows `0xC0000142` (DLL init failure), so no
  client can connect; and the stand-alone single-user backend splits input on semicolons, which
  mangles dollar-quoted bodies — the "errors" it reported were the harness misparsing my SQL, not
  defects in it.

That is why the verifiers **assert** rather than display. Constraints nobody has watched refuse
anything are not yet known to work.

**And that limitation cost two round-trips, which is worth recording rather than tidying away.** The
verifier began as one 300-line file and failed twice in Michael's hands:

1. `ERROR 42P01: relation "_verify" does not exist` — it opened with `BEGIN`, created a
   `CREATE TEMP TABLE … ON COMMIT DROP`, and the next statement could not see that table.

   **I recorded the cause as "the editor commits per statement". That is now known to be wrong**, and
   a wrong recorded lesson is worse than none. On 2026-09-04 the entities migration aborted mid-file
   and a follow-up query confirmed **all four** of its objects absent — so an explicit
   `BEGIN…COMMIT` in a multi-statement script *does* hold and *does* roll back on error.

   Two facts, both measured: an explicit transaction holds across statements; a temp table created in
   one statement was invisible to the next. Together those rule out per-statement commits. The most
   likely remaining explanation is that the editor's statements do not share one **session** —
   a temp table is session-scoped, so per-statement connection pooling would produce exactly this —
   but I have not proven that and am not going to swap one guess for another.

   **The fix is robust either way**, which is why the code was never in doubt: everything happens
   inside one `DO` block, so it needs neither a shared session nor a particular transaction model.
   The trailing `ROLLBACK` was the real defect regardless — had the block succeeded, the fixtures
   would have been committed under a header promising the script changed nothing.

2. `ERROR 22P02: malformed array literal: "PASS  05 …"` — the report accumulated into a `text[]`, and
   `res || 'literal'` with an **untyped** literal makes Postgres prefer `anyarray || anyarray`, so it
   tried to parse the sentence as an array. Checks 01–04 passed only because they used `format()`,
   which returns typed `text`. Four green checks over a broken accumulator: *they could not fail in a
   way that revealed the defect*, which is this program's signature failure, occurring inside my own
   test harness.

So it is now **four small scripts** instead of one large one, on Michael's instruction, and the
design reflects the lesson:

- **Script 1 is read-only and contains no plpgsql at all** — pure catalog queries returning a table.
  That removes most of the risk surface, and it works even before the migration is applied.
- Scripts 2–4 each create one or two throwaway templates and **end by raising**, which is what forces
  the rollback. No `BEGIN`/`ROLLBACK`, no temp tables, no dependence on editor transaction semantics.
- Every appended report line goes through `format()`. Not one bare literal, which is the exact bug
  from (2), and a checker now greps for that pattern specifically.

## 7. Phase 2 — entities (ASK 2): DECIDED, and the migration written

**Status:** `supabase/migrations/20260904_diligence_entities.sql`, written 2026-09-04, not yet run.
Verifiers: `20260904_verify_entities_1_structure.sql` (catalog-only, works before or after) and
`..._2_behaviour.sql` (fixtures, ends by raising, changes nothing).

A per-entity block **is** a group that repeats per named entity — the live session's point, and it is
why `is_entity_parameterized` and `entity_role` were declared in the groups migration: this phase
adds only the deal side.

I originally left three questions for Michael. He said to start, so they are **answered below with
the reasoning**, and each is stated so it can be overruled. Two I consider settled by the domain; the
third is the expensive one and the one to challenge if any.

### Q1. The entity-role vocabulary → a seeded catalog TABLE

Not a `CHECK`, not free text. The question as I posed it was a false choice — *"a fixed list will be
wrong for some lender; free text can never be reported on consistently."* A catalog table dissolves
it: roles are **rows**, so adding `co-developer` for one lender is an `INSERT` Michael can do without
a migration, while the foreign key keeps *"every guarantor across the portfolio"* answerable. Free
text would have made that query return `Guarantor`, `guarantor` and `GUARANTOR` as three things.

Seeded with the LIHTC set PNC's structure implies: ownership, general partner, developer, sponsor,
guarantor, contractor, management agent.

### Q2. Per-deal or reusable → REUSABLE, org catalog plus a deal join

*"Every deal this guarantor is on"* is a real CFO question, and LIHTC sponsors and guarantors
genuinely recur — the same few principals guarantee many deals. Nine copies of one guarantor cannot
answer that at all.

**The cost I accepted, stated plainly:** reuse needs someone to notice that "Smith Family Trust" and
"The Smith Family Trust" are the same entity, and nothing here forces that. It is *mitigated*, not
solved — `dm_diligence_deal_entities.display_name` lets a deal label an entity differently without
forking it, so differing paperwork does not create duplicates. If duplicates accumulate anyway,
merging is a later problem with a small blast radius: the join is the only thing pointing at an
entity.

### Q3. Their own sign-off chain → YES, `entity_id` on the spine

**This is the expensive one and the one to overrule if any.** I chose it because the source document
answers it: PNC lists guarantors i/ii/iii as separate blocks with separate items, which only means
anything if each is tracked, assigned, documented and signed off separately.

The cheap alternative — display-only entities — renders three headings over **one shared item**, so
approving it for guarantor i marks it approved for all three. That is a false record on a
cost-certification-adjacent checklist.

`dm_diligence_signoffs` already keys on `deal_item_id`, so per-entity items get their own chains with
**no change to the sign-off tables**. That is the payoff for putting the dimension on the spine
rather than beside it.

**If you overrule:** leave the column, stop the code populating it. It is nullable and every existing
row stays NULL, so display-only stays reachable without reverting anything.

### The NULL trap, which is why this needed a migration and not a patch

The spine was `UNIQUE (deal_id, item_id)`. Folding `entity_id` into that constraint would be a silent
data-integrity failure: **Postgres treats NULLs as distinct in a unique constraint**, so every
non-entity row — all 62 today, and all of them forever on non-entity items — would permit unlimited
duplicates. `ensureDealItems` is self-healing and runs on **every diligence page load**, so it would
have inserted a fresh duplicate set on each page view until the table was unusable.

Two **partial** unique indexes instead, which say what they mean:

```sql
CREATE UNIQUE INDEX ... ON dm_diligence_deal_items (deal_id, item_id)
  WHERE entity_id IS NULL;
CREATE UNIQUE INDEX ... ON dm_diligence_deal_items (deal_id, item_id, entity_id)
  WHERE entity_id IS NOT NULL;
```

`UNIQUE NULLS NOT DISTINCT` would also work on PG 15+, but the partial pair is version-proof and
self-documenting. **Check 5 of verifier 2 is the one that matters** — it proves a duplicate
non-entity row is refused while the same item for two different entities is allowed.

The old constraint is dropped **by looking up its name**, not by guessing: `0081` declared it inline,
so the name is system-generated and a guess would leave the old rule in force beside the new ones.

### What still needs code (not schema, so not Michael's to run)

`ensureDealItems` must instantiate an entity-parameterized group's items **once per deal entity of
that role**, and the checklist must render entities as collapsible groups with an entity filter —
never as tabs, since membership overlaps. Plus a deal-level UI to name the entities in the first
place. None of that exists yet; the schema is what this phase delivers.

## 8. Code that follows the migration (not schema, so not yours to run)

| ASK 6 item | Work |
|---|---|
| (a) template-owned groups | groups CRUD in the template drawer: add / rename / reorder / delete a section, and assign an item to one |
| (b) two-plus levels | subsection creation under a section; indented rendering to depth 2 |
| (c) ordering | reorder groups (one UPDATE); item reorder becomes *within-group*, so `moveTemplateItem` swaps with the previous item **in the same group** — the existing three-step park-and-swap is unchanged, only the neighbour query gains a `group_id` predicate |
| (e) importer | *Section* / *Subsection* column mapping; create-or-attach groups on commit, so the supplied spreadsheet round-trips with its structure intact |
| (f) deal-side | when viewing a packet, render **its** group headers instead of the canonical 15 |

(d) is the constraint the whole design is built around and needs no work: coverage never reads this
table.

**One thing to know before approving the code:** grouping a template changes how the importer must
behave, and PNC's 329 items are the first real test of it. I'd rather import that file into a
throwaway template and compare against the spreadsheet section by section than ship the importer
change and find out on a live packet.
