# Template-owned item groups — design (ASK 6, and the schema ASK 2 was waiting on)

**Status:** migration written, not run. `supabase/migrations/20260903_diligence_item_groups.sql`
**Verifier:** four scripts in `scripts/diagnostics/`, run in order after the migration —
`20260903_verify_groups_1_structure.sql` (read-only, returns a table),
`..._2_depth.sql`, `..._3_integrity.sql`, `..._4_detach.sql` (each creates a throwaway template and
ends by RAISING, which is what rolls it back). Every line must read `PASS`.
Split from one 300-line file after it failed twice on plpgsql type resolution that no checker
available here can see — see §6.
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
   `CREATE TEMP TABLE … ON COMMIT DROP`, and assumed the script was one transaction. The Supabase
   editor **commits per statement**, so the temp table was dropped by its own `ON COMMIT DROP` before
   the next statement ran. The same assumption made the trailing `ROLLBACK` decorative — had the block
   succeeded, its fixtures would have been **committed** into the shared database. It was broken in
   the direction that writes, under a header promising it changed nothing.
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

## 7. Phase 2 — entities (ASK 2), and the questions only you can answer

The browser session's architectural point is right and worth restating: **a per-entity block is a
group that repeats per named entity.** Settling groups settles both asks. `is_entity_parameterized`
and `entity_role` are declared now so the entity migration adds only the deal side, not a second
round of template surgery.

I have **not** written that migration, because it turns on decisions that are yours:

1. **What is the entity-role vocabulary?** PNC's file implies at least *partnership*, *general
   partner*, *developer*, *sponsor*, *guarantor*. Is that list fixed platform-wide, per template, or
   free text? A fixed list is checkable and will be wrong for some lender; free text always fits and
   can never be reported on consistently.
2. **Are named entities per deal or reusable across deals?** A guarantor who appears on nine deals is
   either nine rows or one row referenced nine times. The second is right if you ever want *"every
   deal this guarantor is on"*; the first is far less work.
3. **Do entity items get their own sign-off chain,** or does the group sign off once? This decides
   whether `dm_diligence_deal_items` grows an `entity_id` or whether entities are display-only.

That third question is the expensive one, and here is the trap it hides. The spine is
`UNIQUE (deal_id, item_id)`. Adding `entity_id` makes it `UNIQUE (deal_id, item_id, entity_id)` — and
**Postgres treats NULLs as distinct in a unique constraint**, so every ungrouped item (`entity_id`
NULL, which is all 62 of them today) would permit unlimited duplicates. The fix is two partial unique
indexes rather than one constraint:

```sql
CREATE UNIQUE INDEX ... ON dm_diligence_deal_items (deal_id, item_id)
  WHERE entity_id IS NULL;
CREATE UNIQUE INDEX ... ON dm_diligence_deal_items (deal_id, item_id, entity_id)
  WHERE entity_id IS NOT NULL;
```

(`UNIQUE NULLS NOT DISTINCT` would also work on PG 15+, but the paired partial indexes are
version-proof and say what they mean.)

Answer 1–3 and I'll write that migration the same way as this one: pre-flight, explicit grants, and a
self-asserting verifier.

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
