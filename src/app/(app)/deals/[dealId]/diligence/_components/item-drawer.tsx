"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, FileIcon, type FileType } from "@/components/nurock-ui";
import FileDropZone from "@/components/file-drop-zone";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { categoryLabel } from "@/lib/diligence/categories";
import { formatDate } from "@/lib/format";
import type { DiligenceItem, TeamMember, LibraryDoc } from "@/lib/data/diligence";
import type { DiligenceStatus } from "@/lib/data/diligence-rollup";
import { DILIGENCE_STATUSES, STATUS_META, WAIVE_STATES } from "./status";
import { MetPill } from "./met-pill";
import {
  getDiligenceDocSignedUrl,
  setDiligenceAssignee,
  setDiligenceDueDate,
  setDiligenceCompletedDate,
  setDiligenceNotes,
  setDiligenceStatus,
  setDiligenceDocumentRequirement,
  addDiligenceExpectedDoc,
  removeDiligenceExpectedDoc,
  assignDiligenceExpectedDoc,
  linkDiligenceDocument,
  unlinkDiligenceDocument,
  uploadDiligenceDocument,
  recordDiligenceSignoff,
  clearDiligenceSignoff,
  type SignoffRole,
} from "../actions";

const UNASSIGNED = "__unassigned__";
const UNFILLED_SLOT = "__unfilled__";

const SIGNOFF_ROLES: { role: SignoffRole; label: string }[] = [
  { role: "preparer", label: "Preparer" },
  { role: "reviewer", label: "Reviewer" },
  { role: "approver", label: "Approver" },
];

function fileTypeOf(name: string, mime: string | null): FileType {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (/\.(xls|xlsx|csv)$/.test(n)) return n.endsWith(".csv") ? "csv" : "xls";
  if (/\.(doc|docx)$/.test(n)) return "doc";
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(n) || mime?.startsWith("image/"))
    return "img";
  return "doc";
}

export function ItemDrawer({
  item,
  dealId,
  dealName,
  team,
  library = [],
  canEdit,
  canApprove,
  open,
  onOpenChange,
}: {
  item: DiligenceItem | null;
  dealId: string;
  dealName: string;
  team: TeamMember[];
  /** The deal's shared document library (Part 2) — for link-without-reupload. */
  library?: LibraryDoc[];
  canEdit: boolean;
  canApprove: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  // Part 2 — library-link picker selection.
  const [linkDocId, setLinkDocId] = React.useState("");
  // Expected-document slot being added (migration 0100).
  const [newSlotLabel, setNewSlotLabel] = React.useState("");

  // Seed local notes when a new item opens.
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  if (item && seededFor !== item.id) {
    setSeededFor(item.id);
    setNotes(item.notes ?? "");
    setFile(null);
    setLinkDocId("");
    setNewSlotLabel("");
  }

  // Library documents not already linked to this item.
  const linkableLibraryDocs = React.useMemo(() => {
    if (!item) return [] as LibraryDoc[];
    const linked = new Set(item.docs.map((d) => d.id));
    return library.filter((d) => !linked.has(d.id));
  }, [library, item]);

  // Item 7: unlink confirms via the app's standard modal, not confirm().
  // (Declared BEFORE the null-item early return — hooks must run on every
  // render or React throws on the null→item transition.)
  const [docToRemove, setDocToRemove] = React.useState<string | null>(null);
  // Clearing an actual-met date is destructive to user-recorded truth —
  // confirm via the app modal before wiping (migration 0101 brief).
  const [confirmClearMet, setConfirmClearMet] = React.useState(false);

  if (!item) return null;

  function run(fn: () => Promise<{ error?: string }>, okMsg?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (okMsg) toast.success(okMsg);
      router.refresh();
    });
  }

  function onStatusChange(next: DiligenceStatus) {
    if (WAIVE_STATES.includes(next)) {
      const reason = window.prompt(
        next === "waived"
          ? "Reason this item is waived (e.g. lender dropped requirement):"
          : "Reason this item is N/A for this deal:"
      );
      if (!reason?.trim()) return;
      run(
        () =>
          setDiligenceStatus({
            dealId,
            dealItemIds: [item!.id],
            status: next,
            waivedReason: reason.trim(),
          }),
        `Marked ${STATUS_META[next].label}`
      );
      return;
    }
    run(
      () => setDiligenceStatus({ dealId, dealItemIds: [item!.id], status: next }),
      `Status → ${STATUS_META[next].label}`
    );
  }

  function onAssign(value: string) {
    const assigneeUserId = value === UNASSIGNED ? null : value;
    run(
      () =>
        setDiligenceAssignee({
          dealId,
          dealItemIds: [item!.id],
          assigneeUserId,
          itemLabel: item!.title,
        }),
      assigneeUserId ? "Assigned" : "Unassigned"
    );
  }

  function onUpload() {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("dealId", dealId);
    fd.set("dealItemId", item!.id);
    fd.set("dealName", dealName);
    fd.set("itemTitle", item!.title);
    if (item!.itemNumber != null) fd.set("itemNumber", String(item!.itemNumber));
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadDiligenceDocument(fd);
      setUploading(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Document uploaded");
      setFile(null);
      router.refresh();
    });
  }

  async function onView(filePath: string) {
    const res = await getDiligenceDocSignedUrl({ filePath });
    if (res.error || !res.signedUrl) {
      toast.error(res.error ?? "Could not open file");
      return;
    }
    window.open(res.signedUrl, "_blank", "noopener");
  }

  function onRemoveDoc(documentId: string) {
    setDocToRemove(documentId);
  }

  function confirmRemoveDoc() {
    const documentId = docToRemove;
    if (!documentId) return;
    run(
      () => unlinkDiligenceDocument({ dealId, dealItemId: item!.id, documentId }),
      "Document removed"
    );
  }

  const meta = STATUS_META[item.status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px] overflow-y-auto">
        <SheetHeader className="pr-10">
          <div className="flex items-center gap-2">
            <Badge tone="navy">{categoryLabel(item.category)}</Badge>
            <Badge tone={meta.badge}>{meta.label}</Badge>
            {!item.isRequired && <Badge tone="slate">Optional</Badge>}
          </div>
          <SheetTitle className="font-display text-lg text-nurock-black mt-1">
            {item.itemNumber != null ? `${item.itemNumber}. ` : ""}
            {item.title}
          </SheetTitle>
          {item.description && (
            <SheetDescription className="text-[13px] leading-relaxed">
              {item.description}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          {/* Quick approve — routes through the APPROVER sign-off (item 3:
              status is never set to approved directly), so the server's
              sequencing gate applies: Preparer and Reviewer must have signed
              off first, else this errors with the reason. */}
          {canApprove && item.status === "submitted" && (
            <Button
              onClick={() =>
                run(
                  () =>
                    recordDiligenceSignoff({
                      dealId,
                      dealItemId: item!.id,
                      role: "approver",
                      decision: "approved",
                    }),
                  "Approved"
                )
              }
              disabled={pending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> Approve (as Approver)
            </Button>
          )}

          {/* Status + assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Status</Label>
              <Select
                value={item.status}
                onValueChange={(v) => onStatusChange(v as DiligenceStatus)}
                disabled={!canEdit || pending}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DILIGENCE_STATUSES.map((s) => (
                    <SelectItem
                      key={s}
                      value={s}
                      // Item 3: Approved can't be picked directly — it is
                      // granted by the Approver's sign-off below (still
                      // renders here so an approved item's current status
                      // displays correctly).
                      disabled={s === "approved"}
                    >
                      {STATUS_META[s].label}
                      {s === "approved" ? " (via sign-off)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Assignee</Label>
              <Select
                value={item.assigneeUserId ?? UNASSIGNED}
                onValueChange={onAssign}
                disabled={!canEdit || pending}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {team.map((t) => (
                    <SelectItem key={t.userId} value={t.userId}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-1">
            <Label htmlFor="dd-due" className="text-xs font-medium">
              Due date
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="dd-due"
                type="date"
                // Re-key on the persisted value so the uncontrolled input
                // re-syncs after a server refresh — otherwise a stale
                // defaultValue lingers after saves/clears.
                key={`due-${item.id}-${item.dueDate ?? "none"}`}
                defaultValue={item.dueDate ?? ""}
                disabled={!canEdit || pending}
                onChange={(e) =>
                  run(() =>
                    setDiligenceDueDate({
                      dealId,
                      dealItemId: item.id,
                      dueDate: e.target.value || null,
                    })
                  )
                }
                className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
              />
              {/* Explicit clear — the date input's own clear affordance is
                  browser-dependent and its change event proved unreliable for
                  emptying; this button guarantees a persisted removal. */}
              {canEdit && item.dueDate && (
                <button
                  type="button"
                  onClick={() =>
                    run(
                      () =>
                        setDiligenceDueDate({
                          dealId,
                          dealItemId: item.id,
                          dueDate: null,
                        }),
                      "Due date removed"
                    )
                  }
                  disabled={pending}
                  className="shrink-0 h-9 px-2.5 text-[12px] rounded border border-nurock-border text-nurock-slate hover:text-red-700 hover:border-red-300 disabled:opacity-50"
                  title="Remove the due date"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Actual met date (migration 0101) — target vs. actual. Independent
              of the due date above (setting it never modifies the target).
              Sign-off approval defaults it to today; here it can be set,
              back-dated, or (with confirmation) cleared. */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="dd-met" className="text-xs font-medium">
                Actual met
              </Label>
              <MetPill dueDate={item.dueDate} completedDate={item.completedDate} />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="dd-met"
                type="date"
                // Same re-key trick as the due date — uncontrolled input
                // re-syncs after a server refresh.
                key={`met-${item.id}-${item.completedDate ?? "none"}`}
                defaultValue={item.completedDate ?? ""}
                disabled={!canEdit || pending}
                onChange={(e) =>
                  run(() =>
                    setDiligenceCompletedDate({
                      dealId,
                      dealItemId: item.id,
                      completedDate: e.target.value || null,
                    })
                  )
                }
                className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
              />
              {canEdit && !item.completedDate && (
                <button
                  type="button"
                  onClick={() =>
                    run(
                      () =>
                        setDiligenceCompletedDate({
                          dealId,
                          dealItemId: item.id,
                          completedDate: new Date().toISOString().slice(0, 10),
                        }),
                      "Marked met today"
                    )
                  }
                  disabled={pending}
                  className="shrink-0 h-9 px-2.5 text-[12px] rounded border border-nurock-border text-nurock-slate hover:text-emerald-700 hover:border-emerald-300 disabled:opacity-50"
                  title="Record this item as met today (editable afterwards)"
                >
                  Met today
                </button>
              )}
              {canEdit && item.completedDate && (
                <button
                  type="button"
                  onClick={() => setConfirmClearMet(true)}
                  disabled={pending}
                  className="shrink-0 h-9 px-2.5 text-[12px] rounded border border-nurock-border text-nurock-slate hover:text-red-700 hover:border-red-300 disabled:opacity-50"
                  title="Clear the recorded met date (asks for confirmation)"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label htmlFor="dd-notes" className="text-xs font-medium">
              Notes
            </Label>
            <Textarea
              id="dd-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if ((item.notes ?? "") !== notes)
                  run(() =>
                    setDiligenceNotes({ dealId, dealItemId: item.id, notes })
                  );
              }}
              rows={2}
              disabled={!canEdit || pending}
              className="resize-none text-sm"
              placeholder="Internal notes, follow-ups, where the doc lives…"
            />
            {item.status === "waived" || item.status === "na" ? (
              <p className="text-[11px] text-nurock-slate-light">
                {STATUS_META[item.status].label} reason: {item.waivedReason}
              </p>
            ) : null}
          </div>

          {/* Documents — many-to-many: this item's linked docs from the deal's
              shared library (Part 2). Upload adds to the library AND links;
              existing library docs link without re-uploading. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">
                Documents ({item.docs.length})
              </Label>
              {/* Requirement mode — read by the Approver gate. */}
              <div
                className="flex items-center gap-1"
                title="What the Approver gate expects before approval: every expected-document slot filled ('All expected' — items with no slots need at least one linked document), or any one linked document ('Any one' — either/or items like EIN Letter / W-9)."
              >
                <span className="text-[10px] uppercase tracking-wider text-nurock-slate-light">
                  Require
                </span>
                {(["all", "any"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!canEdit || pending}
                    onClick={() =>
                      item.documentRequirement !== mode &&
                      run(
                        () =>
                          setDiligenceDocumentRequirement({
                            dealId,
                            dealItemId: item!.id,
                            mode,
                          }),
                        mode === "all"
                          ? "Requiring all linked documents"
                          : "Any one linked document suffices"
                      )
                    }
                    className={`px-1.5 py-0.5 rounded text-[10px] border ${
                      item.documentRequirement === mode
                        ? "bg-nurock-navy text-white border-nurock-navy"
                        : "border-nurock-border text-nurock-slate hover:border-nurock-navy/40"
                    } disabled:opacity-50`}
                  >
                    {mode === "all" ? "All expected" : "Any one"}
                  </button>
                ))}
              </div>
            </div>
            {item.docs.length > 0 && (
              <div className="space-y-1.5">
                {item.docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2.5 p-2 rounded border border-nurock-border bg-white"
                  >
                    <FileIcon type={fileTypeOf(d.originalFilename, d.mimeType)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-nurock-black truncate">
                        {d.displayName ?? d.originalFilename}
                      </div>
                      {d.byteSize != null && (
                        <div className="text-[10.5px] text-nurock-slate-light">
                          {d.byteSize < 1024
                            ? "<1 KB"
                            : `${(d.byteSize / 1024).toFixed(0)} KB`}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onView(d.filePath)}
                      className="p-1 text-nurock-slate hover:text-nurock-navy"
                      title="Open"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => onRemoveDoc(d.id)}
                        disabled={pending}
                        className="p-1 text-red-700 hover:bg-red-50 rounded disabled:opacity-50"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Expected-document slots (migration 0100). Under "All expected"
                the Approver gate requires every slot filled by a linked doc;
                under "Any one" the slots are advisory. */}
            {(item.expectedDocs.length > 0 || canEdit) && (
              <div className="rounded border border-nurock-border bg-nurock-gray/20 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-nurock-slate-light">
                    Expected documents
                  </span>
                  <span className="text-[10px] text-nurock-slate-light text-right">
                    {item.documentRequirement === "all"
                      ? item.expectedDocs.length > 0
                        ? "Every slot must be filled before the Approver can approve"
                        : "No slots yet — any one linked document gates approval"
                      : "Advisory — any one linked document suffices"}
                  </span>
                </div>
                {item.expectedDocs.map((slot) => {
                  const filledDoc = slot.documentId
                    ? item.docs.find((d) => d.id === slot.documentId)
                    : undefined;
                  return (
                    <div key={slot.id} className="flex items-center gap-2">
                      {filledDoc ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-nurock-slate-light shrink-0" />
                      )}
                      <span className="text-[12px] text-nurock-black flex-1 truncate">
                        {slot.label}
                      </span>
                      <Select
                        value={filledDoc ? slot.documentId! : UNFILLED_SLOT}
                        onValueChange={(v) =>
                          run(
                            () =>
                              assignDiligenceExpectedDoc({
                                dealId,
                                dealItemId: item!.id,
                                expectedDocId: slot.id,
                                documentId: v === UNFILLED_SLOT ? null : v,
                              }),
                            v === UNFILLED_SLOT ? "Slot cleared" : "Slot filled"
                          )
                        }
                        disabled={!canEdit || pending}
                      >
                        <SelectTrigger className="h-7 text-[11px] w-[190px]">
                          <SelectValue placeholder="Assign a linked doc…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNFILLED_SLOT}>
                            — unfilled —
                          </SelectItem>
                          {item.docs.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.displayName ?? d.originalFilename}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {canEdit && (
                        <button
                          onClick={() =>
                            run(
                              () =>
                                removeDiligenceExpectedDoc({
                                  dealId,
                                  expectedDocId: slot.id,
                                }),
                              "Slot removed"
                            )
                          }
                          disabled={pending}
                          className="p-1 text-nurock-slate-light hover:text-red-600 disabled:opacity-50"
                          title="Remove this expected-document slot"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <input
                      value={newSlotLabel}
                      onChange={(e) => setNewSlotLabel(e.target.value)}
                      placeholder="Add expected document (e.g. W-9)"
                      className="h-8 flex-1 px-2 text-[12px] border rounded border-nurock-border bg-white"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!newSlotLabel.trim() || pending}
                      onClick={() => {
                        const label = newSlotLabel.trim();
                        if (!label) return;
                        setNewSlotLabel("");
                        run(
                          () =>
                            addDiligenceExpectedDoc({
                              dealId,
                              dealItemId: item!.id,
                              label,
                            }),
                          "Expected document added"
                        );
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Link an existing library document (no re-upload). */}
            {canEdit && linkableLibraryDocs.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={linkDocId} onValueChange={setLinkDocId}>
                  <SelectTrigger className="h-8 text-[12px] flex-1">
                    <SelectValue placeholder="Link a document from the deal library…" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkableLibraryDocs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.displayName ?? d.originalFilename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!linkDocId || pending}
                  onClick={() => {
                    const id = linkDocId;
                    if (!id) return;
                    setLinkDocId("");
                    run(
                      () =>
                        linkDiligenceDocument({
                          dealId,
                          dealItemId: item!.id,
                          documentId: id,
                        }),
                      "Document linked"
                    );
                  }}
                >
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Link
                </Button>
              </div>
            )}

            {canEdit && (
              <div className="space-y-2">
                <FileDropZone
                  file={file}
                  onFileChange={setFile}
                  accept="application/pdf,image/,.pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                  acceptLabel="PDF, Office, or image"
                  maxBytes={50 * 1024 * 1024}
                />
                {file && (
                  <Button
                    onClick={onUpload}
                    disabled={uploading || pending}
                    className="w-full bg-nurock-navy hover:bg-nurock-navy-dark text-white"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" /> Upload & link
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Sign-off chain */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Sign-off chain</Label>
            <div className="space-y-1.5">
              {SIGNOFF_ROLES.map(({ role, label }) => {
                const s = item.signoffs.find((x) => x.role === role);
                const canAct = role === "approver" ? canApprove : canEdit;
                return (
                  <div
                    key={role}
                    className="flex items-center justify-between gap-2 rounded border border-nurock-border px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <span className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light">
                        {label}
                      </span>
                      <div className="text-[12px]">
                        {s ? (
                          <span
                            className={
                              s.decision === "approved"
                                ? "text-emerald-700"
                                : "text-red-700"
                            }
                          >
                            {s.decision === "approved" ? "✓ Approved" : "✗ Rejected"}
                            {s.actorName ? ` · ${s.actorName}` : ""}
                          </span>
                        ) : (
                          <span className="text-nurock-slate-light italic">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                    {canAct && (
                      <div className="flex items-center gap-1 shrink-0">
                        {s ? (
                          <button
                            onClick={() =>
                              run(
                                () =>
                                  clearDiligenceSignoff({
                                    dealId,
                                    dealItemId: item!.id,
                                    role,
                                  }),
                                "Sign-off cleared"
                              )
                            }
                            disabled={pending}
                            className="text-[11px] text-nurock-slate-light hover:text-nurock-navy"
                          >
                            Undo
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                run(
                                  () =>
                                    recordDiligenceSignoff({
                                      dealId,
                                      dealItemId: item!.id,
                                      role,
                                      decision: "approved",
                                    }),
                                  `${label} approved`
                                )
                              }
                              disabled={pending}
                              className="text-[11px] rounded border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-0.5 hover:bg-emerald-100"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                run(
                                  () =>
                                    recordDiligenceSignoff({
                                      dealId,
                                      dealItemId: item!.id,
                                      role,
                                      decision: "rejected",
                                    }),
                                  `${label} rejected`
                                )
                              }
                              disabled={pending}
                              className="text-[11px] rounded border border-red-200 bg-red-50 text-red-700 px-2 py-0.5 hover:bg-red-100"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10.5px] text-nurock-slate-light">
              The chain runs Preparer → Reviewer → Approver in order; the
              approver&apos;s decision sets the item&apos;s status, and undoing
              a step also undoes everything after it.
            </p>
          </div>

          {item.approvedAt && (
            <p className="text-[11px] text-emerald-700">
              Approved {formatDate(item.approvedAt)}
            </p>
          )}
        </div>

        {/* Item 7: document unlink — standard app modal instead of confirm(). */}
        <ConfirmDialog
          open={docToRemove !== null}
          onOpenChange={(o) => {
            if (!o) setDocToRemove(null);
          }}
          title="Remove document?"
          description="Unlink this document from the item. The file itself stays in the deal's document library if other items reference it."
          confirmLabel="Remove"
          destructive
          pending={pending}
          onConfirm={confirmRemoveDoc}
        />
        <ConfirmDialog
          open={confirmClearMet}
          onOpenChange={setConfirmClearMet}
          title="Clear the met date?"
          description={`This removes the recorded actual-met date${
            item.completedDate ? ` (${formatDate(item.completedDate)})` : ""
          }. The due date and item status are not affected.`}
          confirmLabel="Clear date"
          destructive
          pending={pending}
          onConfirm={() => {
            setConfirmClearMet(false);
            run(
              () =>
                setDiligenceCompletedDate({
                  dealId,
                  dealItemId: item.id,
                  completedDate: null,
                }),
              "Met date cleared"
            );
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
