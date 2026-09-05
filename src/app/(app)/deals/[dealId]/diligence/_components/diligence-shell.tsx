"use client";

// ============================================================================
// Due-Diligence Shell (Increment 1)
// ----------------------------------------------------------------------------
// Readiness header (coverage ring + KPI tiles + outstanding-by-owner), a filter
// bar, a category-grouped checklist table with row selection + a bulk toolbar,
// and the item-detail drawer. Subscribes to realtime so status changes from
// teammates reflect live.
// ============================================================================

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  matchesPacketScope,
  packetsPresent,
  PACKET_SCOPE_CANONICAL,
} from "@/lib/diligence/item-filters";
import {
  groupBySection,
  groupCombined,
} from "@/lib/diligence/checklist-groups";
import { OrgChartDialog } from "./org-chart-dialog";
import { DealPartiesPanel } from "./deal-parties-panel";
import {
  getOrgChartRequirements,
  type OrgChartRole,
  type DealEntityRow,
} from "../entity-actions";
import {
  ClipboardList,
  Download,
  Search,
  AlertTriangle,
  Bell,
  Paperclip,
  Building2,
  X,
  FileDown,
  Clock,
  Loader2,
  Info,
  Plus,
  Upload,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileText,
  FolderOpen,
} from "lucide-react";
import { Card, KpiTile, Badge, CircularProgress, FileIcon, type FileType } from "@/components/nurock-ui";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { triggerDownload } from "@/lib/export/download";
import { coverageTone } from "@/lib/design-tokens";
import {
  categoryLabel,
  DILIGENCE_CATEGORIES,
} from "@/lib/diligence/categories";
import type { DiligenceChecklist, DiligenceItem, LibraryDoc } from "@/lib/data/diligence";
import type {
  DiligenceStatus,
  FinancierCoverage,
} from "@/lib/data/diligence-rollup";
import type { TemplateSummary } from "@/lib/data/diligence-templates";
import type { DeadlineItem } from "@/lib/data/diligence-deadlines";
import {
  docDisplayName,
  docExt,
  docIconType,
  docSizeLabel,
  isPdfDoc,
  isImageDoc,
  isPreviewable,
} from "@/lib/diligence/doc-display";
import { DILIGENCE_STATUSES, STATUS_META, WAIVE_STATES } from "./status";
import { MetPill, metVarianceDays } from "./met-pill";
import { ItemDrawer } from "./item-drawer";
import {
  nudgeDiligenceAssignee,
  setDiligenceAssignee,
  setDiligenceStatus,
  exportDiligencePacket,
  exportFinancierPacket,
  getDiligenceDocSignedUrl,
} from "../actions";
import {
  adoptTemplateForDeal,
  unadoptTemplateForDeal,
} from "../../../../settings/diligence-templates/actions";
import {
  CreateDialog,
  ImportDialog,
} from "../../../../settings/diligence-templates/_components/templates-admin";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
// R2.2 filter sentinels. Distinct values rather than reusing UNASSIGNED,
// because "no packet" and "nobody responsible" are different questions and a
// shared sentinel would make one filter silently answer the other.
// Re-exported from the filter module so the sentinel the UI offers and the one
// the predicate tests can never drift apart.
const CANONICAL_ONLY = PACKET_SCOPE_CANONICAL;
const RESPONSIBLE_NOBODY = "__resp_nobody__";
// PREFIX, not a single sentinel. Michael asked the financier option to name the
// actual financier ("PNC Bank"), not the generic word — and a deal can carry
// packets from two lenders, so one shared sentinel would filter to "whichever
// financier" and silently conflate them. The name rides in the value.
const RESPONSIBLE_FINANCIER_PREFIX = "__resp_fin__:";
const BULK_PLACEHOLDER = "__bulk__";

const RING_TONE: Record<string, "green" | "amber" | "red" | "navy"> = {
  ok: "green",
  warn: "amber",
  bad: "red",
  muted: "navy",
};

const READINESS_BAR: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  muted: "bg-nurock-navy",
};

const STATUS_BADGE_BY_TONE: Record<
  string,
  "green" | "amber" | "red" | "navy"
> = {
  ok: "green",
  warn: "amber",
  bad: "red",
  muted: "navy",
};

export function DiligenceShell({
  checklist,
  financiers,
  deadlines,
  availableTemplates,
  canEdit,
  canApprove,
  canExport,
}: {
  checklist: DiligenceChecklist;
  financiers: FinancierCoverage[];
  deadlines: DeadlineItem[];
  availableTemplates: TemplateSummary[];
  canEdit: boolean;
  canApprove: boolean;
  /** canDiligence("export") — gates BOTH export controls, see the page note. */
  canExport: boolean;
}) {
  const { dealId, dealName, items, team, parties, rollup, library } = checklist;
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = React.useState<string>(ALL);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>(ALL);
  // R2.2: narrowing to one packet, and to who OWES an item. Both default to ALL
  // so the combined checklist is what loads — these narrow it, they never
  // replace it with a per-packet mode.
  const [packetFilter, setPacketFilter] = React.useState<string>(ALL);
  const [responsibleFilter, setResponsibleFilter] = React.useState<string>(ALL);
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = React.useState<DiligenceItem | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [includeDocs, setIncludeDocs] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [exportingFinancierId, setExportingFinancierId] = React.useState<string | null>(null);
  // Document Vault (split-pane) — selected file + its live preview URL.
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = React.useState<string | null>(null);
  // Guards against a stale signed-URL resolving after a newer selection.
  const previewReqRef = React.useRef(0);
  const selectedDoc = React.useMemo(
    () => library.find((d) => d.id === selectedDocId) ?? null,
    [library, selectedDocId],
  );
  // Part 2 — Create/Import surfaced on the main page (not just Settings).
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const todayIso = React.useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

  // Realtime — reflect teammates' status/assignment changes without a manual
  // refresh (mirrors the notifications-bell subscription pattern).
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`dm_diligence_deal_items:${dealId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dm_diligence_deal_items",
          filter: `deal_id=eq.${dealId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, router]);

  // Keep the open drawer's data fresh after a refresh.
  React.useEffect(() => {
    if (!drawerItem) return;
    const next = items.find((i) => i.id === drawerItem.id) ?? null;
    setDrawerItem(next);
    if (!next) setDrawerOpen(false);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Packets actually present on THIS deal's checklist, derived from the items
  // rather than from availableTemplates: a template can be adopted and still
  // have contributed no items, and offering a filter that can only ever return
  // nothing is worse than not offering it.
  // Same module, same reason: the "which packets are here" decision and the
  // "is this item in scope" decision have to agree, and they only reliably
  // agree when they are one tested thing rather than two inline conditions.
  const packetOptions = React.useMemo(() => packetsPresent(items), [items]);

  /**
   * Financiers that actually appear on this checklist, for the responsible
   * filter (R55-1).
   *
   * Michael asked for the ACTUAL financier name rather than the generic word
   * "The financier". responsible_is_financier is only a boolean — it does not
   * record WHICH financier — but it does not need to: the financier is whoever
   * owns the packet the item came from, so "PNC Bank is responsible" resolves
   * to `responsibleIsFinancier AND this item's financier is PNC Bank`. That is
   * derivable per row, and it stays correct on a deal carrying two packets from
   * two different lenders, where one generic option would have conflated them.
   */
  const financierOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const i of items) {
      if (!i.isCanonicalTemplate && i.financierName) seen.add(i.financierName);
    }
    return Array.from(seen).sort();
  }, [items]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !i.title.toLowerCase().includes(q)) return false;
      if (statusFilter !== ALL && i.status !== statusFilter) return false;
      if (categoryFilter !== ALL && i.category !== categoryFilter) return false;
      if (assigneeFilter === UNASSIGNED && i.assigneeUserId) return false;
      if (
        assigneeFilter !== ALL &&
        assigneeFilter !== UNASSIGNED &&
        i.assigneeUserId !== assigneeFilter
      )
        return false;
      // ONE TESTED PREDICATE, not a condition rewritten per call site. The
      // inline version kept the wrong assumption after packetOptions was
      // corrected for it — canonical items DO have a template, the canonical
      // one — so "NuRock standard only" returned 0 of 97 while the CSV export
      // listed 59 canonical rows on the same deal. Fixing one site and leaving
      // the other is how it survived a round; lib/diligence/item-filters.ts now
      // owns the decision and its tests pin the partition property.
      if (!matchesPacketScope(i, packetFilter)) return false;
      // Responsible party is a THREE-state field (a user, the financier, or
      // undecided), so the filter needs its own sentinels rather than reusing
      // the assignee ones — "nobody decided" is a real answer people will want
      // to chase, not the absence of a filter.
      if (responsibleFilter === RESPONSIBLE_NOBODY) {
        if (i.responsibleUserId || i.responsibleIsFinancier) return false;
      } else if (responsibleFilter.startsWith(RESPONSIBLE_FINANCIER_PREFIX)) {
        // Named financier (R55-1), resolved per row from the item's own packet.
        const want = responsibleFilter.slice(RESPONSIBLE_FINANCIER_PREFIX.length);
        if (!i.responsibleIsFinancier || i.financierName !== want) return false;
      } else if (
        responsibleFilter !== ALL &&
        i.responsibleUserId !== responsibleFilter
      ) {
        return false;
      }
      if (overdueOnly) {
        const overdue =
          i.dueDate != null &&
          i.dueDate < todayIso &&
          i.status !== "approved" &&
          !WAIVE_STATES.includes(i.status);
        if (!overdue) return false;
      }
      return true;
    });
  }, [
    items,
    query,
    statusFilter,
    categoryFilter,
    assigneeFilter,
    packetFilter,
    responsibleFilter,
    overdueOnly,
    todayIso,
  ]);

  // ---------------------------------------------------------------------------
  // GROUPING — canonical categories by default, THE PACKET'S OWN SECTIONS when
  // filtered to one packet (R2.2)
  // ---------------------------------------------------------------------------
  // Michael's instruction was explicit: a per-packet view as A FILTER OVER A
  // COMBINED DEFAULT, never a segmented switcher. So the checklist still opens
  // showing everything grouped by the canonical LIHTC categories, and narrowing
  // to one packet re-groups it under that lender's OWN section names.
  //
  // That re-grouping is the point rather than a flourish. Filtered to PNC, the
  // list should read like the document PNC actually sent — "1. Entity
  // Information", "2. Real Estate" — because the person working it has that
  // file open beside the screen. Showing PNC's items under NuRock's canonical
  // categories would force them to translate between two structures on every
  // row, which is exactly what the groups work exists to stop.
  //
  // Falls back to categories when the packet has no sections of its own, so a
  // flat imported checklist does not collapse into one nameless heap.
  const groups = React.useMemo(() => {
    const rollUp = (key: string, label: string, blurb: string | undefined, arr: DiligenceItem[]) => {
      const approved = arr.filter((i) => i.status === "approved").length;
      const waived = arr.filter((i) => WAIVE_STATES.includes(i.status)).length;
      const submitted = arr.filter((i) => i.status === "submitted").length;
      const overdue = arr.filter(
        (i) =>
          i.dueDate != null &&
          i.dueDate < todayIso &&
          i.status !== "approved" &&
          !WAIVE_STATES.includes(i.status)
      ).length;
      return {
        key,
        label,
        blurb,
        items: arr,
        total: arr.length,
        // "Done" = terminal-satisfied (approved OR waived/na) — nothing left
        // to chase in this section.
        done: approved + waived,
        submitted,
        overdue,
      };
    };

    // THE GROUPING ITSELF LIVES IN lib/diligence/checklist-groups.ts, tested.
    //
    // Round 57 found two rendering faults that the engine's own correctness
    // hid: 274 packet rows counted but never drawn (the old code kept only the
    // fifteen canonical categories, and imported items are "imported"), and a
    // repeating block rendered as one section per ROLE so two GP entities'
    // rows appeared as identical consecutive pairs with neither party named.
    //
    // Both are invisible to any test that inspects a group's contents, because
    // the fault is in what never appears. The module's tests assert a PARTITION
    // instead — every item in exactly one group, groups summing to the input —
    // and reintroducing either bug fails five of them.
    const packetHasSections =
      packetFilter !== ALL && filtered.some((i) => i.groupId !== null);
    const shaped = packetHasSections
      ? groupBySection(filtered)
      : groupCombined(filtered);
    return shaped.map((g) => rollUp(g.key, g.label, g.blurb, g.items));
  }, [filtered, todayIso, packetFilter]);

  // Collapsible category sections. Seed COLLAPSED with the fully-satisfied
  // categories (every item approved/waived/na) so a fresh load isn't a wall of
  // 80+ rows — the sections still needing attention stay open. Runs once from
  // the initial items; the user's toggles win thereafter (realtime refreshes
  // never reset their choices, and a newly-seen category defaults open).
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => {
    const byCat = new Map<string, DiligenceItem[]>();
    for (const i of items) {
      const arr = byCat.get(i.category) ?? [];
      arr.push(i);
      byCat.set(i.category, arr);
    }
    const done = new Set<string>();
    for (const [key, arr] of byCat) {
      if (
        arr.length > 0 &&
        arr.every(
          (i) => i.status === "approved" || WAIVE_STATES.includes(i.status)
        )
      )
        done.add(key);
    }
    return done;
  });

  // A search or any active filter force-EXPANDS every group so matches are
  // never hidden behind a collapsed header (without mutating the user's set).
  const filtersActive =
    query.trim() !== "" ||
    statusFilter !== ALL ||
    categoryFilter !== ALL ||
    assigneeFilter !== ALL ||
    packetFilter !== ALL ||
    responsibleFilter !== ALL ||
    overdueOnly;

  function toggleCategory(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.key)));

  const selectedIds = Array.from(selected);
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      if (filtered.every((i) => prev.has(i.id))) {
        const next = new Set(prev);
        filtered.forEach((i) => next.delete(i.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function openItem(i: DiligenceItem) {
    setDrawerItem(i);
    setDrawerOpen(true);
  }

  function bulkStatus(next: DiligenceStatus) {
    if (selectedIds.length === 0) return;
    // Item 3: bulk writes are limited to non-terminal statuses. Approved is
    // granted only by the Approver's sign-off; Waived / N/A are per-item
    // decisions with a reason (open the item). The menu below only offers
    // non-terminal options; this guard backstops it (the server enforces too).
    if (next === "approved" || WAIVE_STATES.includes(next)) {
      toast.error(
        next === "approved"
          ? "Approved is granted via each item's sign-off chain."
          : "Waived / N/A are per-item decisions — open each item to record the reason."
      );
      return;
    }
    startTransition(async () => {
      const res = await setDiligenceStatus({
        dealId,
        dealItemIds: selectedIds,
        status: next,
        waivedReason: null,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${selectedIds.length} item(s) → ${STATUS_META[next].label}`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkAssign(value: string) {
    if (selectedIds.length === 0) return;
    const assigneeUserId = value === UNASSIGNED ? null : value;
    startTransition(async () => {
      const res = await setDiligenceAssignee({
        dealId,
        dealItemIds: selectedIds,
        assigneeUserId,
        notify: true,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        assigneeUserId
          ? `Assigned ${selectedIds.length} item(s)`
          : `Unassigned ${selectedIds.length} item(s)`
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  function handleExport(scopeIds?: string[]) {
    const rows = (scopeIds ? items.filter((i) => scopeIds.includes(i.id)) : items).map(
      (i) => {
        const variance = i.completedDate
          ? metVarianceDays(i.dueDate, i.completedDate)
          : null;
        return [
          categoryLabel(i.category),
          // The packet and its own section, so an exported row can be matched
          // back to the lender's document. Both blank for canonical items.
          i.templateName ?? "",
          // THE SAME SEPARATOR THE UI USES. This was " > " while the checklist
          // rendered " › ", so the export and the screen spelled one section
          // two ways — harmless to read, and a trap for anything downstream
          // matching on the string. The file is already UTF-8 and already
          // carries "±" and "−" in the variance column, so the character costs
          // nothing here.
          [i.groupParentLabel, i.groupLabel].filter(Boolean).join(" › "),
          i.itemNumber ?? "",
          i.title,
          STATUS_META[i.status].label,
          i.isRequired ? "Required" : "Optional",
          // Responsible party flattens to a name either way — a spreadsheet
          // cannot carry the icon, and "PNC Bank" in a Responsible column is
          // unambiguous on its own.
          i.responsibleName ?? "",
          i.assigneeName ?? "",
          i.dueDate ?? "",
          i.completedDate ?? "",
          variance === null ? "" : variance > 0 ? `Late +${variance}d` : variance < 0 ? `On time −${-variance}d` : "On time ±0d",
          i.docs.length,
          i.notes ?? "",
        ];
      }
    );
    import("@/lib/export/download").then(({ downloadCsv }) => {
      downloadCsv(
        // KEEP IN STEP WITH THE ROW ARRAY ABOVE. A header and a row built in
        // two places is how a CSV silently shifts every column by one.
        ["Category", "Packet", "Section", "Item #", "Item", "Status", "Required", "Responsible", "Assignee", "Due", "Met", "On Time / Late", "Docs", "Notes"],
        rows,
        `${dealName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-due-diligence-${todayIso}.csv`
      );
      toast.success("Checklist exported");
    });
  }

  // Part 2 — library helpers: item titles for the "linked to" tooltip, and
  // signed-URL open (same flow as the drawer's document view).
  const itemTitleById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) {
      m.set(it.id, it.itemNumber != null ? `${it.itemNumber}. ${it.title}` : it.title);
    }
    return m;
  }, [items]);

  async function onViewLibraryDoc(filePath: string) {
    const res = await getDiligenceDocSignedUrl({ filePath });
    if (res.error || !res.signedUrl) {
      toast.error(res.error ?? "Could not open file");
      return;
    }
    window.open(res.signedUrl, "_blank", "noopener");
  }

  // Document Vault — select a file for the right-pane preview. Only fetches a
  // live signed URL for inline-previewable types (PDF / image); others render a
  // styled placeholder. A request token guards against a slow URL landing after
  // a newer selection (signed URLs also expire, so we re-fetch on every select).
  async function selectDoc(d: LibraryDoc) {
    const token = ++previewReqRef.current;
    setSelectedDocId(d.id);
    setPreviewUrl(null);
    setPreviewError(null);
    if (!isPreviewable(d)) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await getDiligenceDocSignedUrl({ filePath: d.filePath });
      if (token !== previewReqRef.current) return; // superseded by a newer select
      if (res.error || !res.signedUrl) {
        setPreviewError(res.error ?? "Could not load preview");
      } else {
        setPreviewUrl(res.signedUrl);
      }
    } catch {
      if (token === previewReqRef.current) setPreviewError("Could not load preview");
    } finally {
      if (token === previewReqRef.current) setPreviewLoading(false);
    }
  }

  // Force a real download (signed URL is cross-origin, so the anchor `download`
  // hint alone won't stick — fetch to a blob, then save).
  async function downloadDoc(d: LibraryDoc) {
    setDownloadingDocId(d.id);
    try {
      const res = await getDiligenceDocSignedUrl({ filePath: d.filePath });
      if (res.error || !res.signedUrl) {
        toast.error(res.error ?? "Could not download file");
        return;
      }
      const resp = await fetch(res.signedUrl);
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docDisplayName(d);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingDocId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // ADOPTION, VIA THE ORG CHART WHEN THE PACKET NEEDS ONE (ASK 2)
  // ---------------------------------------------------------------------------
  // A packet whose sections repeat per party cannot populate until the deal
  // says who those parties are — that is Michael's spec: type the org chart
  // BEFORE the template becomes a real list. So adoption checks first and, when
  // there are repeating blocks, routes through the org-chart dialog.
  //
  // A packet with none adopts in exactly one click, as before. Making everyone
  // walk through an empty org chart to attach an ordinary checklist would tax
  // the common case for a feature most packets do not use.
  //
  // The check is a read, so a failure must not silently swallow the adoption:
  // if it errors, say so and stop rather than attaching a packet that will look
  // inexplicably empty.
  const [orgChart, setOrgChart] = React.useState<{
    templateId: string;
    templateName: string;
    roles: OrgChartRole[];
    existing: DealEntityRow[];
  } | null>(null);

  function adoptPacket(templateId: string) {
    startTransition(async () => {
      const req = await getOrgChartRequirements({ dealId, templateId });
      if (req.error) {
        toast.error(req.error);
        return;
      }
      if ((req.roles ?? []).length > 0) {
        setOrgChart({
          templateId,
          templateName:
            availableTemplates.find((t) => t.id === templateId)?.name ??
            "This packet",
          roles: req.roles ?? [],
          existing: req.existing ?? [],
        });
        return;
      }
      await runAdopt(templateId);
    });
  }

  async function runAdopt(templateId: string) {
    const res = await adoptTemplateForDeal({ dealId, templateId });
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Packet added");
    router.refresh();
  }

  // Item 7: packet removal confirms via the app's standard modal (see
  // <ConfirmDialog> at the bottom of the tree), not a native confirm().
  const [packetToRemove, setPacketToRemove] = React.useState<{
    templateId: string;
    name: string;
    /** Rows this packet contributed, counted from the checklist itself. */
    rowCount: number;
  } | null>(null);

  function removePacket(templateId: string, name: string) {
    // Counted from the loaded items rather than asked of the server: it is the
    // same list the table is rendering, so the number in the dialog is the
    // number on screen. Entity-scoped rows are included, which is the point —
    // a repeating block is where the count gets surprising.
    const rowCount = items.filter((i) => i.templateId === templateId).length;
    setPacketToRemove({ templateId, name, rowCount });
  }

  function confirmRemovePacket() {
    const target = packetToRemove;
    if (!target) return;
    startTransition(async () => {
      const res = await unadoptTemplateForDeal({
        dealId,
        templateId: target.templateId,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      // SAY WHAT IT ACTUALLY DID. "Packet removed" was true and useless: the
      // rule is that untouched rows go and worked rows stay, and until now the
      // only way to learn which had happened was to count the checklist by
      // hand. Kept rows are the surprising half — they remain on the checklist
      // after the packet is gone — so they are named explicitly.
      const removed = res.removed ?? 0;
      const kept = res.kept ?? 0;
      // THE TWO NUMBERS MUST RECONCILE OUT LOUD. The confirmation dialog names
      // the total; this names what became of it. Round 60c had the dialog
      // promise 249 and the toast report 248, with nothing accounting for the
      // difference — the count was right and the sentence was silent about the
      // one row that survived, which is worse than a missing number because two
      // visible figures disagreed by one and nothing explained why.
      toast.success(
        kept > 0
          ? `Packet removed — ${removed} row${removed === 1 ? "" : "s"} deleted, ${kept} kept because ${kept === 1 ? "it has" : "they have"} work or documents on ${kept === 1 ? "it" : "them"}.`
          : `Packet removed — ${removed} row${removed === 1 ? "" : "s"} deleted.`
      );
      router.refresh();
    });
  }

  function runPacketExport() {
    setExporting(true);
    startTransition(async () => {
      const res = await exportDiligencePacket({ dealId, includeDocs });
      setExporting(false);
      if (res.error || !res.base64 || !res.filename || !res.mime) {
        toast.error(res.error ?? "Export failed");
        return;
      }
      triggerDownload({
        base64: res.base64,
        filename: res.filename,
        mime: res.mime,
      });
      toast.success("Packet generated");
      setExportOpen(false);
    });
  }

  function runFinancierExport(templateId: string) {
    setExportingFinancierId(templateId);
    startTransition(async () => {
      const res = await exportFinancierPacket({ dealId, templateId });
      setExportingFinancierId(null);
      if (res.error || !res.base64 || !res.filename || !res.mime) {
        toast.error(res.error ?? "Export failed");
        return;
      }
      triggerDownload({
        base64: res.base64,
        filename: res.filename,
        mime: res.mime,
      });
      toast.success("Financier packet generated");
    });
  }

  function nudge(userId: string, count: number) {
    startTransition(async () => {
      const res = await nudgeDiligenceAssignee({
        dealId,
        assigneeUserId: userId,
        outstandingCount: count,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Reminder sent");
    });
  }

  const ringTone = RING_TONE[coverageTone(rollup.coveragePct)];

  return (
    // TODO(shared-ui): replace with SHELL_CONTENT_MAX_W once shared-ui has a
    //                  remote — see Part 7
    // 1600 (was 1400) + mx-auto (was MISSING, so this surface left-aligned
    // while all five other capped surfaces centered). Free change: measured at
    // 1440 with the rail expanded to 220px, this surface's content box is
    // 1205px and its widest table 1139px with scrollWidth === clientWidth and
    // zero overflowing elements — nothing here wants more than ~1150px, so the
    // cap only bites above ~1500px, where it now matches its siblings.
    <div className="px-8 py-6 space-y-6 mx-auto w-full max-w-[1600px]">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-nurock-navy/5 rounded-md p-2 border border-nurock-navy/10">
            <ClipboardList className="w-5 h-5 text-nurock-navy" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-nurock-black">
              Due Diligence
            </h1>
            <p className="text-sm text-nurock-slate-light">
              NuRock standard closing checklist — assign, track, and collect
              every required document
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Part 2 — create/import surfaced here, not only in Settings. */}
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="h-8"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                New checklist/packet
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="h-8"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Import Excel/CSV
              </Button>
            </>
          )}
          {/* BOTH EXPORTS, OR NEITHER. Round 63 measured a contributor being
              refused the PDF ("Your role doesn't allow exporting from Due
              Diligence") and handed a 59-row CSV by the button beside it — the
              CSV path builds the file in the browser and never asks the server.
              Two adjacent controls labelled Export, one permission, opposite
              answers. The rows are already on that user's screen, so this gate
              is honesty rather than a barrier; see the note on canExport in the
              page component. */}
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport()}
              className="h-8"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export CSV
            </Button>
          )}
          {canExport && (
          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            className="h-8 bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            <FileDown className="w-3.5 h-3.5 mr-1.5" />
            {/* "Export packet" collided with the other meaning of packet.
                Round 55 flagged this button rendering on a deal with no packet
                adopted and read it as the same can-do-nothing bug as the filter
                — reasonably, because everywhere else on this page "packet"
                means a financier's adopted template. It is not that bug: this
                exports the DEAL'S CHECKLIST as a branded PDF and is valid on
                any deal, packets or none. One word meaning two things is the
                actual defect, so the button now says what it produces. */}
            Export PDF
          </Button>
          )}
        </div>
      </div>

      {/* Readiness header */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-4">
            <CircularProgress
              value={rollup.coveragePct ?? 0}
              max={100}
              size={92}
              tone={ringTone}
              label={
                <div className="font-display text-[24px] font-bold leading-none tabular-nums text-nurock-black">
                  {rollup.coveragePct == null ? "—" : `${rollup.coveragePct}%`}
                </div>
              }
              sublabel={
                <div className="mt-0.5 font-display text-[8px] font-semibold uppercase tracking-wider text-[#667085]">
                  ready
                </div>
              }
            />
            <div>
              <div
                className="font-display text-sm uppercase tracking-wider text-nurock-slate inline-flex items-center gap-1.5"
                // Item 2: deal STAGE (header badge, e.g. "Committed") and this
                // readiness % are intentionally independent measures — stage is
                // the platform-wide deal lifecycle set on the underwriting /
                // development side; readiness tracks only this checklist's
                // sign-offs. A Committed deal can legitimately sit at 0% ready
                // (diligence often begins in earnest at commitment).
                title="Diligence readiness measures THIS checklist's approvals only. The deal's stage badge (top bar) is the platform lifecycle set in Underwriting/Development — the two are intentionally independent: a Committed deal can be 0% ready while diligence is just starting."
              >
                Readiness
                <Info className="w-3 h-3 text-nurock-slate-light" />
              </div>
              <div className="text-[13px] text-nurock-slate-light mt-0.5 max-w-[220px] leading-snug">
                {rollup.approved} of {rollup.applicable} required items approved
                {rollup.waivedCount + rollup.naCount > 0
                  ? ` · ${rollup.waivedCount + rollup.naCount} waived/N-A`
                  : ""}
              </div>
              <div className="text-[11px] text-nurock-slate-light mt-1 max-w-[220px] leading-snug">
                Independent of the deal&apos;s lifecycle stage
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
            <KpiTile
              tone="green"
              label="Approved"
              value={`${rollup.approved}/${rollup.applicable}`}
              sub="Required items signed off"
            />
            <KpiTile
              tone={rollup.outstandingCount > 0 ? "amber" : "green"}
              label="Outstanding"
              value={String(rollup.outstandingCount)}
              sub="Required, not yet approved"
            />
            <KpiTile
              tone={rollup.overdueCount > 0 ? "red" : "green"}
              label="Overdue"
              value={String(rollup.overdueCount)}
              sub="Past due date"
            />
            <KpiTile
              tone="navy"
              label="Submitted"
              value={String(rollup.submitted)}
              sub="Awaiting approval"
            />
          </div>
        </div>

        {/* Outstanding by owner */}
        {rollup.byAssignee.length > 0 && (
          <div className="mt-4 pt-4 border-t border-nurock-border">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light mr-1">
                Outstanding by owner
              </span>
              {rollup.byAssignee.map((a) => (
                <span
                  key={a.userId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-nurock-border bg-white px-2.5 py-1 text-[11px] text-nurock-slate"
                >
                  {a.name}
                  <span className="font-mono font-semibold text-nurock-navy">
                    {a.outstanding}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => nudge(a.userId, a.outstanding)}
                      title="Email a reminder"
                      className="text-nurock-slate-light hover:text-nurock-navy"
                    >
                      <Bell className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* LIHTC deadline strip */}
      {deadlines.length > 0 && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light inline-flex items-center gap-1">
            <Clock className="w-3 h-3" /> LIHTC deadlines
          </span>
          {deadlines.slice(0, 7).map((d) => {
            const cls =
              d.tone === "bad"
                ? "border-red-200 bg-red-50 text-red-700"
                : d.tone === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-nurock-border bg-white text-nurock-slate";
            const rel = d.past
              ? `${Math.abs(d.daysRemaining)}d ago`
              : d.daysRemaining === 0
                ? "today"
                : `in ${d.daysRemaining}d`;
            // Item 1: show each milestone's OWN date inline. Several LIHTC
            // milestones legitimately share a date (construction starts at
            // closing; PIS at CO), so countdown-only chips read as a collapse
            // bug — the visible date makes identical countdowns self-evident.
            const short = (() => {
              // Part A: 4-digit year (M/D/YYYY). Was m[1].slice(2) → 2-digit "26".
              const m = d.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
              return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : d.date;
            })();
            return (
              <span
                key={d.key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${cls}`}
                title={`${d.label}: ${formatDate(d.date)} — from the UW model's key dates (keyDates.${d.key}). Milestones sharing a date share a countdown by definition.`}
              >
                {d.label}
                <span className="opacity-70 tabular-nums">{short}</span>
                <span className="font-semibold">{rel}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Per-financier coverage (investor / lender packets) */}
      {(financiers.length > 0 ||
        (canEdit && availableTemplates.length > 0)) && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="font-display text-sm uppercase tracking-wider text-nurock-slate">
              Investor &amp; Lender Packets
            </h2>
            {canEdit && availableTemplates.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-nurock-slate-light hidden md:inline">
                  Coverage maps from your standard items via the crosswalk
                </span>
                <Select
                  value={BULK_PLACEHOLDER}
                  onValueChange={(v) => {
                    if (v !== BULK_PLACEHOLDER) adoptPacket(v);
                  }}
                >
                  <SelectTrigger className="h-8 text-[12px] w-[220px]">
                    <SelectValue placeholder="+ Add packet…">
                      + Add packet…
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* THE TEMPLATE NAME IS THE IDENTITY, financier is context.
                        This read `{t.financierName ?? t.name}`, which showed
                        ONLY the financier whenever one was set — so two PNC
                        templates both rendered as "PNC Bank" and nothing on
                        screen told them apart. Round 54 hit exactly that: two
                        identical options, one of them a packet the tester was
                        forbidden to touch, resolvable only by reading React
                        internals. Adopting the wrong packet onto a live deal
                        was a coin flip. */}
                    {availableTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex flex-col items-start leading-tight">
                          <span>{t.name}</span>
                          {t.financierName && t.financierName !== t.name && (
                            // opacity ALONGSIDE the colour, deliberately.
                            // Round 55 measured both lines computing the same
                            // near-black, so the colour class alone is losing
                            // to something — SelectItem carries a
                            // `focus:**:text-accent-foreground` rule that
                            // repaints every descendant. Opacity composes with
                            // whatever colour ends up winning, so the second
                            // line reads as secondary either way.
                            <span className="text-[10.5px] text-nurock-slate-light opacity-70">
                              {t.financierName}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {financiers.length === 0 ? (
            <Card className="p-4 text-[12px] text-nurock-slate-light">
              No investor or lender packets on this deal yet. Add one above to
              track its coverage against your standard checklist.
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {financiers.map((f) => {
                const tone = coverageTone(f.coveragePct);
                return (
                  <Card key={f.templateId} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* THE SAME DEFECT THE PICKER HAD, IN A SECOND PLACE.
                            This read `{f.financierName ?? f.name}`, so a packet
                            with a financier showed only "PNC Bank" — and with
                            two PNC packets in the catalog nobody could tell
                            which one was actually on the deal. Round 55 found
                            it surviving here after the picker was fixed.
                            Template name is the identity; financier is
                            context. */}
                        <div className="font-display text-[13px] font-semibold text-nurock-black truncate">
                          {f.name}
                        </div>
                        <div className="text-[10.5px] uppercase tracking-wider text-nurock-slate-light truncate">
                          {f.financierName && f.financierName !== f.name
                            ? `${f.financierName} · `
                            : ""}
                          {f.kind === "investor"
                            ? "Investor"
                            : f.kind === "lender"
                              ? "Lender"
                              : f.kind === "underwriter"
                                ? "Underwriter"
                                : "Packet"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={STATUS_BADGE_BY_TONE[tone]}>
                          {f.coveragePct == null ? "—" : `${f.coveragePct}%`}
                        </Badge>
                        <button
                          onClick={() => runFinancierExport(f.templateId)}
                          disabled={exportingFinancierId === f.templateId}
                          className="text-nurock-slate-light hover:text-nurock-navy disabled:opacity-50"
                          title="Export this financier's item list (with satisfied state) as a PDF"
                        >
                          {exportingFinancierId === f.templateId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => removePacket(f.templateId, f.name)}
                            className="text-nurock-slate-light hover:text-red-600"
                            title="Remove packet from deal"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 relative h-2 overflow-hidden rounded-full bg-[#F2F4F7]">
                      <div
                        className={`h-full transition-[width] duration-500 ${READINESS_BAR[tone]}`}
                        style={{ width: `${f.coveragePct ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-nurock-slate-light">
                      {/* "REQUIREMENTS COVERED", not "items satisfied".
                          Round 57: this card read "0/242 items satisfied" while
                          the same screen said the deal had gained 274 rows —
                          two counts of apparently the same thing, disagreeing.
                          Both were right and neither said so. This counts the
                          LENDER'S REQUIREMENTS met through the crosswalk; the
                          deal's counter counts TRACKED ROWS, and a repeating
                          block turns one requirement into one row per party, so
                          they legitimately differ and always will. The numbers
                          were never wrong — the word "items" was, because it is
                          the same word the checklist uses for rows. */}
                      <span title="How many of this packet's requirements are covered by your standard checklist, via the crosswalk. Not the same as the number of rows on the deal — a section that repeats per party becomes one row per party.">
                        {f.satisfied}/{f.total} requirements covered
                      </span>
                      {f.unmappedCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700"
                          title="Items on this packet with no NuRock-standard mapping yet"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {f.unmappedCount} unmapped
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------
          THE DEAL'S ORG CHART, VISIBLE AFTER ADOPTION
          ---------------------------------------------------------------
          Parties could previously only be typed during packet adoption and
          were then unreachable: nothing listed them, nothing removed one, and
          the per-deal name override had no UI. Round 58 made that concrete —
          six test parties could not be deleted from the catalog (correctly,
          the deal still named them) and nothing could stop the deal naming
          them, so the only way out was hand-written SQL.

          Rendered only when there is something to show or fill: a deal running
          a plain canonical checklist has no repeating sections, and an org
          chart there would be a panel about a feature that is not in use. */}
      {(parties.length > 0 || financiers.length > 0) && (
        <DealPartiesPanel
          dealId={dealId}
          parties={parties}
          canEdit={canEdit}
        />
      )}

      {/* ---------------------------------------------------------------
          The Document Library MOVED to /deals/[dealId]/documents (ASK 4).
          ---------------------------------------------------------------
          It was a full split-pane vault right here, at the bottom of this page,
          below the checklist and the deadlines and the packets. Two problems:
          it was reachable only by scrolling past everything else and could not
          be linked to, and it could only ever list documents ALREADY attached
          to a checklist item, because this page assembles `library` from the
          LINK table. A document uploaded to the deal and not yet filed was
          invisible.

          What replaced it reads from dm_diligence_documents outward, so unfiled
          documents are first-class, and it has search and filters.

          THIS IS A POINTER, NOT A SECOND IMPLEMENTATION. Keeping a working copy
          of the vault here as well is exactly how two implementations of one
          concept start disagreeing — the defect family this codebase keeps
          paying for. The per-item document lists in the checklist drawer are
          untouched: "what is attached to THIS item" is a different question and
          is still answered where it is asked.
          --------------------------------------------------------------- */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-sm uppercase tracking-wider text-nurock-slate">
              Document Library
            </h2>
            <p className="text-[12px] text-nurock-slate-light mt-1">
              {library.length === 0
                ? "No documents on this deal yet — upload straight to the library, or from any item's drawer."
                : `${library.length} document${library.length === 1 ? "" : "s"}, linkable to any number of checklist items.`}
            </p>
          </div>
          <Link
            href={`/deals/${dealId}/documents`}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-nurock-border bg-white px-3 py-1.5 text-[12px] font-medium text-nurock-navy shadow-sm hover:bg-nurock-gray"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Document Library
          </Link>
        </div>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nurock-slate-light" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className="h-9 pl-8 pr-3 text-sm border rounded border-nurock-border w-[220px]"
          />
        </div>
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          options={DILIGENCE_STATUSES.map((s) => ({
            value: s,
            label: STATUS_META[s].label,
          }))}
        />
        <FilterSelect
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="All categories"
          options={DILIGENCE_CATEGORIES.map((c) => ({
            value: c.key,
            label: c.label,
          }))}
        />
        <FilterSelect
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          placeholder="All owners"
          options={[
            { value: UNASSIGNED, label: "Unassigned" },
            ...team.map((t) => ({ value: t.userId, label: t.name })),
          ]}
        />
        {/* R2.2: the per-packet view, as a FILTER over the combined default.
            Narrowing to one packet also re-groups the table under that
            lender's own section names — see the grouping memo above. Only
            rendered when the deal actually has a packet beyond the canonical
            checklist; a one-option filter is furniture, not a control. */}
        {packetOptions.length > 0 && (
          <FilterSelect
            value={packetFilter}
            onChange={setPacketFilter}
            placeholder="All packets"
            options={[
              { value: CANONICAL_ONLY, label: "NuRock standard only" },
              ...packetOptions,
            ]}
          />
        )}
        <FilterSelect
          value={responsibleFilter}
          onChange={setResponsibleFilter}
          placeholder="Anyone responsible"
          options={[
            // "No responsible party" rather than "Nobody decided yet" (R55-2):
            // the same register as the rest of the app, and it now matches the
            // item drawer's own null label so one concept reads one way in both
            // places.
            { value: RESPONSIBLE_NOBODY, label: "No responsible party" },
            // Named financiers, not the generic word (R55-1). Only those
            // actually on this checklist appear.
            ...financierOptions.map((f) => ({
              value: `${RESPONSIBLE_FINANCIER_PREFIX}${f}`,
              label: `${f} (financier)`,
            })),
            ...team.map((t) => ({ value: t.userId, label: t.name })),
          ]}
        />
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded text-[12px] border transition ${
            overdueOnly
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-nurock-border bg-white text-nurock-slate hover:bg-nurock-gray"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Overdue
        </button>
        <div className="ml-auto flex items-center gap-3">
          {!filtersActive && groups.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                onClick={expandAll}
                className="text-nurock-slate-light hover:text-nurock-navy"
              >
                Expand all
              </button>
              <span className="text-nurock-border">·</span>
              <button
                onClick={collapseAll}
                className="text-nurock-slate-light hover:text-nurock-navy"
              >
                Collapse all
              </button>
            </div>
          )}
          <span className="text-[12px] text-nurock-slate-light">
            {filtered.length} of {items.length} items
          </span>
        </div>
      </div>

      {/* Bulk toolbar */}
      {canEdit && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-nurock-navy/20 bg-nurock-navy/[0.03] px-3 py-2">
          <span className="text-[12px] font-medium text-nurock-navy">
            {selectedIds.length} selected
          </span>
          <BulkSelect
            placeholder="Set status…"
            options={DILIGENCE_STATUSES.filter(
              (s) => s !== "approved" && !WAIVE_STATES.includes(s)
            ).map((s) => ({
              value: s,
              label: STATUS_META[s].label,
            }))}
            onPick={(v) => bulkStatus(v as DiligenceStatus)}
          />
          <BulkSelect
            placeholder="Assign to…"
            options={[
              { value: UNASSIGNED, label: "Unassigned" },
              ...team.map((t) => ({ value: t.userId, label: t.name })),
            ]}
            onPick={bulkAssign}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => handleExport(selectedIds)}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export selected
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-nurock-slate-light hover:text-nurock-navy ml-1"
          >
            Clear
          </button>
        </div>
      )}

      {/* Checklist */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center bg-white border-dashed border-2 border-nurock-border">
          <ClipboardList className="w-12 h-12 mx-auto text-nurock-slate-light mb-4" />
          <h2 className="font-display text-lg text-nurock-black mb-2">
            No items match these filters
          </h2>
          <p className="text-sm text-nurock-slate-light">
            Adjust the filters above to see the rest of the checklist.
          </p>
        </Card>
      ) : (
        <Card className="bg-white overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-nurock-slate-light border-b border-nurock-border">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible"
                  />
                </th>
                <th className="px-2 py-2 font-display font-medium">Item</th>
                <th className="px-3 py-2 font-display font-medium">Status</th>
                {/* R2.2 columns. Responsible sits beside Assignee because the
                    pairing is the point — who owes it, and who is chasing
                    it. */}
                <th className="px-3 py-2 font-display font-medium">
                  Responsible
                </th>
                <th className="px-3 py-2 font-display font-medium">Assignee</th>
                <th className="px-3 py-2 font-display font-medium">Due</th>
                <th className="px-3 py-2 font-display font-medium">Met</th>
                <th className="px-3 py-2 font-display font-medium text-center">
                  Docs
                </th>
                <th className="px-3 py-2 font-display font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isOpen = filtersActive || !collapsed.has(g.key);
                const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
                return (
                <React.Fragment key={g.key}>
                  <tr className="bg-nurock-gray/40 border-y border-nurock-border">
                    {/* 9 = checkbox, Item, Status, Responsible, Assignee, Due,
                        Met, Docs, Notes. Kept in step with the <thead> above —
                        a stale colSpan silently shortens the section header bar
                        and the mismatch is easy to miss on a wide table. */}
                    <td colSpan={9} className="p-0">
                      {/* Collapsible category header — the whole bar toggles the
                          section; the right-side roll-up keeps a collapsed
                          category informative (done/total + bar, plus overdue /
                          in-review counts). */}
                      <button
                        type="button"
                        onClick={() => toggleCategory(g.key)}
                        aria-expanded={isOpen}
                        disabled={filtersActive}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-nurock-gray/70 disabled:cursor-default disabled:hover:bg-transparent"
                        title={
                          filtersActive
                            ? "Clear filters to collapse categories"
                            : isOpen
                              ? `Collapse ${g.label}`
                              : `Expand ${g.label}`
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-nurock-slate" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-nurock-slate" />
                        )}
                        <span className="font-display text-[11px] uppercase tracking-[0.08em] text-nurock-navy font-semibold">
                          {g.label}
                        </span>
                        <span className="hidden md:inline truncate text-[11px] text-nurock-slate-light">
                          {g.blurb}
                        </span>
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {g.overdue > 0 && (
                            <span className="rounded-full bg-[#FEF3F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#B42318]">
                              {g.overdue} overdue
                            </span>
                          )}
                          {g.submitted > 0 && (
                            <span className="rounded-full bg-[#FFFAEB] px-1.5 py-0.5 text-[10px] font-semibold text-[#B54708]">
                              {g.submitted} in review
                            </span>
                          )}
                          {g.done === g.total ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-semibold text-[#027A48]">
                              <CheckCircle2 className="w-3 h-3" /> Complete
                            </span>
                          ) : (
                            <>
                              <span className="tabular-nums text-[11px] text-nurock-slate">
                                {g.done}/{g.total}
                              </span>
                              <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-[#F2F4F7]">
                                <span
                                  className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </span>
                            </>
                          )}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {isOpen && g.items.map((i) => {
                    const overdue =
                      i.dueDate != null &&
                      i.dueDate < todayIso &&
                      i.status !== "approved" &&
                      !WAIVE_STATES.includes(i.status);
                    return (
                      <tr
                        key={i.id}
                        className="border-b border-nurock-border/60 last:border-0 hover:bg-nurock-gray/20 cursor-pointer"
                        onClick={() => openItem(i)}
                      >
                        <td
                          className="px-4 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(i.id)}
                            onChange={() => toggle(i.id)}
                            aria-label={`Select ${i.title}`}
                          />
                        </td>
                        <td className="px-2 py-2 text-nurock-black">
                          <span className="text-nurock-slate-light font-mono text-[11px] mr-1.5">
                            {i.itemNumber}
                          </span>
                          {i.title}
                          {!i.isRequired && (
                            <span className="ml-2 text-[10px] text-nurock-slate-light">
                              (optional)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_META[i.status].badge}>
                            {STATUS_META[i.status].label}
                          </Badge>
                        </td>
                        {/* RESPONSIBLE PARTY. The financier renders in the
                            packet's own words and is visually distinct from a
                            NuRock name, because "PNC owes this" and "Robby owes
                            this" lead to completely different next actions and
                            a reader scanning 80 rows should not have to
                            remember which names are colleagues. */}
                        <td className="px-3 py-2">
                          {i.responsibleIsFinancier ? (
                            <span className="inline-flex items-center gap-1 text-nurock-tan-dark">
                              <Building2 className="w-3 h-3 shrink-0" />
                              {i.responsibleName ?? "The financier"}
                            </span>
                          ) : i.responsibleName ? (
                            <span className="text-nurock-slate">
                              {i.responsibleName}
                            </span>
                          ) : (
                            // "None" rather than repeating the full phrase.
                            // Round 56 fairly noted this is a third string for
                            // one state, after the drawer and filter were made
                            // to agree on "No responsible party". The
                            // difference is that those are CONTROLS, where the
                            // phrase names what you are choosing; this is DATA
                            // under a column already headed "Responsible", so
                            // repeating the noun would be redundant. One word,
                            // unmistakably the same state.
                            <span className="text-nurock-slate-light italic">
                              None
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-nurock-slate">
                          {i.assigneeName ?? (
                            <span className="text-nurock-slate-light italic">
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 whitespace-nowrap ${
                            overdue
                              ? "text-red-700 font-medium"
                              : "text-nurock-slate"
                          }`}
                        >
                          {i.dueDate ? formatDate(i.dueDate) : "—"}
                        </td>
                        {/* Actual met (migration 0101) — target vs. actual +
                            day variance. Waived/NA items show "—": they were
                            never "met", so an on-time/late reading would be
                            fabricated. */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {WAIVE_STATES.includes(i.status) && !i.completedDate ? (
                            <span className="text-nurock-slate-light">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <MetPill
                                dueDate={i.dueDate}
                                completedDate={i.completedDate}
                              />
                              {i.completedDate && (
                                <span className="font-mono tabular-nums text-[11px] text-nurock-slate">
                                  {formatDate(i.completedDate)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {i.docs.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-nurock-slate">
                              <Paperclip className="w-3 h-3" />
                              {i.docs.length}
                            </span>
                          ) : (
                            <span className="text-nurock-slate-light">—</span>
                          )}
                        </td>
                        {/* NOTES. Truncated with the full text on hover rather
                            than wrapped: a note can run to a paragraph, and one
                            long note must not set the row height for the
                            seventy rows around it. The drawer is where notes
                            are read and written in full. */}
                        <td className="px-3 py-2 max-w-[220px]">
                          {i.notes ? (
                            <span
                              className="block truncate text-nurock-slate"
                              title={i.notes}
                            >
                              {i.notes}
                            </span>
                          ) : (
                            <span className="text-nurock-slate-light">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <ItemDrawer
        item={drawerItem}
        dealId={dealId}
        dealName={dealName}
        team={team}
        library={library}
        canEdit={canEdit}
        canApprove={canApprove}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      {/* Part 2 — the same create/import dialogs Settings uses. */}
      {canEdit && (
        <>
          <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />
          <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
        </>
      )}

      {/* ASK 2: the org chart stands between "add packet" and the packet
          appearing, but only for packets whose sections repeat per party.
          onDone runs the adoption itself, so a failed org-chart save never
          leaves a packet attached with nothing to populate it. */}
      {orgChart && (
        <OrgChartDialog
          // KEYED PER TEMPLATE so the form's initial rows are rebuilt for each
          // packet. The dialog derives its rows from `roles` in a state
          // initializer, which only runs on mount — without this key, opening
          // it for a second packet with different roles would reuse the first
          // packet's rows.
          key={orgChart.templateId}
          open
          onOpenChange={(o) => {
            if (!o) setOrgChart(null);
          }}
          dealId={dealId}
          templateName={orgChart.templateName}
          roles={orgChart.roles}
          existing={orgChart.existing}
          onDone={() => {
            const id = orgChart.templateId;
            setOrgChart(null);
            startTransition(async () => {
              await runAdopt(id);
            });
          }}
        />
      )}

      {/* Item 7: packet removal — standard app modal instead of confirm(). */}
      <ConfirmDialog
        open={packetToRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPacketToRemove(null);
        }}
        title="Remove packet?"
        description={
          packetToRemove
            ? // SAY WHAT WILL BE DESTROYED, BEFORE IT IS.
              // The old wording named the two things that survive — the
              // template, and the fact that only coverage disappears — and
              // never mentioned that hundreds of checklist rows are deleted.
              // On the test deal that was 274 rows. That is the consequence a
              // person most needs before confirming, and the count is already
              // known at click time.
              `Remove the "${packetToRemove.name}" packet from this deal? ${
                packetToRemove.rowCount > 0
                  ? `${packetToRemove.rowCount} checklist row${
                      packetToRemove.rowCount === 1 ? "" : "s"
                    } from this packet will be deleted — except any with work, documents or sign-offs on them, which stay. `
                  : ""
              }The template itself stays available in Settings, and the deal's org chart is not affected.`
            : undefined
        }
        confirmLabel="Remove packet"
        destructive
        pending={pending}
        onConfirm={confirmRemovePacket}
      />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export due-diligence packet</DialogTitle>
            <DialogDescription>
              A branded PDF summary of {dealName}&apos;s checklist (readiness,
              investor/lender coverage, every item with status, owner, and due
              date).
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2.5 my-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDocs}
              onChange={(e) => setIncludeDocs(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[13px] text-nurock-black">
              Bundle linked documents
              <span className="block text-[11px] text-nurock-slate-light">
                Downloads a ZIP with the PDF plus every uploaded file, renamed
                to its checklist label. Uncheck for the summary PDF only.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={runPacketExport}
              disabled={exporting}
              className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 mr-2" /> Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small filter Select (controlled, with an "all" sentinel).
// -----------------------------------------------------------------------------
function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm w-[160px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Bulk action Select — resets to placeholder after each pick (it's an action,
// not a persisted value).
function BulkSelect({
  placeholder,
  options,
  onPick,
}: {
  placeholder: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}) {
  return (
    <Select
      value={BULK_PLACEHOLDER}
      onValueChange={(v) => {
        if (v !== BULK_PLACEHOLDER) onPick(v);
      }}
    >
      <SelectTrigger className="h-8 text-[12px] w-[150px]">
        <SelectValue placeholder={placeholder}>{placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
