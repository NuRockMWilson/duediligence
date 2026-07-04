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
import { CheckCircle2, ExternalLink, Loader2, Trash2, Upload } from "lucide-react";
import { categoryLabel } from "@/lib/diligence/categories";
import { formatDate } from "@/lib/format";
import type { DiligenceItem, TeamMember } from "@/lib/data/diligence";
import type { DiligenceStatus } from "@/lib/data/diligence-rollup";
import { DILIGENCE_STATUSES, STATUS_META, WAIVE_STATES } from "./status";
import {
  getDiligenceDocSignedUrl,
  setDiligenceAssignee,
  setDiligenceDueDate,
  setDiligenceNotes,
  setDiligenceStatus,
  unlinkDiligenceDocument,
  uploadDiligenceDocument,
  recordDiligenceSignoff,
  clearDiligenceSignoff,
  type SignoffRole,
} from "../actions";

const UNASSIGNED = "__unassigned__";

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
  canEdit,
  canApprove,
  open,
  onOpenChange,
}: {
  item: DiligenceItem | null;
  dealId: string;
  dealName: string;
  team: TeamMember[];
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

  // Seed local notes when a new item opens.
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  if (item && seededFor !== item.id) {
    setSeededFor(item.id);
    setNotes(item.notes ?? "");
    setFile(null);
  }

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
    if (!confirm("Remove this document from the item?")) return;
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
          {/* Quick approve */}
          {canApprove && item.status === "submitted" && (
            <Button
              onClick={() => onStatusChange("approved")}
              disabled={pending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> Approve item
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
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s].label}
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

          {/* Documents */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">
              Documents ({item.docs.length})
            </Label>
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
              The approver&apos;s decision sets the item&apos;s status. Preparer
              &amp; reviewer steps are advisory.
            </p>
          </div>

          {item.approvedAt && (
            <p className="text-[11px] text-emerald-700">
              Approved {formatDate(item.approvedAt)}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
