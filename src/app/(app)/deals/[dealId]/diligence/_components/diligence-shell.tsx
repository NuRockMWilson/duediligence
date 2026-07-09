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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ClipboardList,
  Download,
  Search,
  AlertTriangle,
  Bell,
  Paperclip,
  X,
  FileDown,
  Clock,
  Loader2,
  Info,
  Plus,
  Upload,
  ExternalLink,
} from "lucide-react";
import { Card, KpiTile, Badge, CircularProgress } from "@/components/nurock-ui";
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
import type { DiligenceChecklist, DiligenceItem } from "@/lib/data/diligence";
import type {
  DiligenceStatus,
  FinancierCoverage,
} from "@/lib/data/diligence-rollup";
import type { TemplateSummary } from "@/lib/data/diligence-templates";
import type { DeadlineItem } from "@/lib/data/diligence-deadlines";
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
}: {
  checklist: DiligenceChecklist;
  financiers: FinancierCoverage[];
  deadlines: DeadlineItem[];
  availableTemplates: TemplateSummary[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const { dealId, dealName, items, team, rollup, library } = checklist;
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = React.useState<string>(ALL);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>(ALL);
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = React.useState<DiligenceItem | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [includeDocs, setIncludeDocs] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [exportingFinancierId, setExportingFinancierId] = React.useState<string | null>(null);
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
  }, [items, query, statusFilter, categoryFilter, assigneeFilter, overdueOnly, todayIso]);

  // Group filtered items by category (seed order).
  const groups = React.useMemo(() => {
    const byCat = new Map<string, DiligenceItem[]>();
    for (const i of filtered) {
      const arr = byCat.get(i.category) ?? [];
      arr.push(i);
      byCat.set(i.category, arr);
    }
    return DILIGENCE_CATEGORIES.filter((c) => byCat.has(c.key)).map((c) => ({
      key: c.key,
      label: c.label,
      blurb: c.blurb,
      items: byCat.get(c.key)!,
    }));
  }, [filtered]);

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
          i.itemNumber ?? "",
          i.title,
          STATUS_META[i.status].label,
          i.isRequired ? "Required" : "Optional",
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
        ["Category", "Item #", "Item", "Status", "Required", "Assignee", "Due", "Met", "On Time / Late", "Docs", "Notes"],
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

  function adoptPacket(templateId: string) {
    startTransition(async () => {
      const res = await adoptTemplateForDeal({ dealId, templateId });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Packet added");
      router.refresh();
    });
  }

  // Item 7: packet removal confirms via the app's standard modal (see
  // <ConfirmDialog> at the bottom of the tree), not a native confirm().
  const [packetToRemove, setPacketToRemove] = React.useState<{
    templateId: string;
    name: string;
  } | null>(null);

  function removePacket(templateId: string, name: string) {
    setPacketToRemove({ templateId, name });
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
      toast.success("Packet removed");
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
    <div className="px-8 py-6 space-y-6 max-w-[1400px]">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport()}
            className="h-8"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            className="h-8 bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            <FileDown className="w-3.5 h-3.5 mr-1.5" />
            Export packet
          </Button>
        </div>
      </div>

      {/* Readiness header */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-4">
            <CircularProgress
              value={rollup.coveragePct}
              max={100}
              size={92}
              tone={ringTone}
              label={
                <div className="font-display text-[24px] font-bold leading-none tabular-nums text-nurock-black">
                  {rollup.coveragePct}%
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
              const m = d.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
              return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : d.date;
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
                  <SelectTrigger className="h-8 text-[12px] w-[180px]">
                    <SelectValue placeholder="+ Add packet…">
                      + Add packet…
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.financierName ?? t.name}
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
                        <div className="font-display text-[13px] font-semibold text-nurock-black truncate">
                          {f.financierName ?? f.name}
                        </div>
                        <div className="text-[10.5px] uppercase tracking-wider text-nurock-slate-light">
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
                          {f.coveragePct}%
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
                        style={{ width: `${f.coveragePct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-nurock-slate-light">
                      <span>
                        {f.satisfied}/{f.total} items satisfied
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

      {/* Part 2 — shared per-deal document library. Any uploaded document can
          be linked to any number of items (link from an item's drawer). */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-3">
          <h2 className="font-display text-sm uppercase tracking-wider text-nurock-slate">
            Document Library
          </h2>
          <span className="text-[11px] text-nurock-slate-light hidden md:inline">
            Uploaded once, linkable to any number of checklist items
          </span>
        </div>
        {library.length === 0 ? (
          <Card className="p-4 text-[12px] text-nurock-slate-light">
            No documents on this deal yet. Upload one from any item&apos;s
            drawer and it appears here, ready to link to other items without
            re-uploading.
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="max-h-[280px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-nurock-slate-light border-b border-nurock-border">
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium w-[90px]">Size</th>
                    <th className="px-3 py-2 font-medium w-[130px]">Linked to</th>
                    <th className="px-3 py-2 w-[60px]" />
                  </tr>
                </thead>
                <tbody>
                  {library.map((d) => {
                    const linkedTitles = d.linkedItemIds
                      .map((id) => itemTitleById.get(id))
                      .filter(Boolean) as string[];
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-nurock-border/60 last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <Paperclip className="w-3.5 h-3.5 text-nurock-slate-light shrink-0" />
                            <span className="truncate text-nurock-black">
                              {d.displayName ?? d.originalFilename}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-nurock-slate-light whitespace-nowrap">
                          {d.byteSize == null
                            ? "—"
                            : d.byteSize < 1024
                              ? "<1 KB"
                              : `${(d.byteSize / 1024).toFixed(0)} KB`}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="text-nurock-slate cursor-default"
                            title={linkedTitles.join("\n") || undefined}
                          >
                            {d.linkedItemIds.length}{" "}
                            {d.linkedItemIds.length === 1 ? "item" : "items"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => onViewLibraryDoc(d.filePath)}
                            className="text-nurock-navy hover:text-nurock-navy-dark"
                            title="Open document"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

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
        <span className="text-[12px] text-nurock-slate-light ml-auto">
          {filtered.length} of {items.length} items
        </span>
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
                <th className="px-3 py-2 font-display font-medium">Assignee</th>
                <th className="px-3 py-2 font-display font-medium">Due</th>
                <th className="px-3 py-2 font-display font-medium">Met</th>
                <th className="px-3 py-2 font-display font-medium text-center">
                  Docs
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  <tr className="bg-nurock-gray/40 border-b border-nurock-border">
                    <td colSpan={7} className="px-4 py-1.5">
                      <span className="font-display text-[11px] uppercase tracking-[0.08em] text-nurock-navy font-semibold">
                        {g.label}
                      </span>
                      <span className="text-[11px] text-nurock-slate-light ml-2">
                        {g.blurb}
                      </span>
                    </td>
                  </tr>
                  {g.items.map((i) => {
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
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
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

      {/* Item 7: packet removal — standard app modal instead of confirm(). */}
      <ConfirmDialog
        open={packetToRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPacketToRemove(null);
        }}
        title="Remove packet?"
        description={
          packetToRemove
            ? `Remove the "${packetToRemove.name}" packet from this deal? Its crosswalk coverage disappears from this page; the template itself stays available in Settings.`
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
