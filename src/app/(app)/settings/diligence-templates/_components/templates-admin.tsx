"use client";

// ============================================================================
// Diligence Templates Admin (Increment 2)
// ----------------------------------------------------------------------------
// Lists the canonical + imported templates, supports manual create + Excel/CSV
// import (upload → map columns → commit), and a per-item crosswalk editor that
// maps an external template's items to the NuRock-standard items (with fuzzy
// suggestions).
// ============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardList,
  Plus,
  Upload,
  Trash2,
  Sparkles,
  X,
  Loader2,
  Link2,
} from "lucide-react";
import { Card, Badge } from "@/components/nurock-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import FileDropZone from "@/components/file-drop-zone";
import { suggestCanonicalMatches } from "@/lib/diligence/fuzzy";
import { categoryLabel } from "@/lib/diligence/categories";
import type {
  TemplateSummary,
  CanonicalItemLite,
  TemplateDetail,
  TemplateKind,
} from "@/lib/data/diligence-templates";
import {
  createDiligenceTemplate,
  deactivateDiligenceTemplate,
  previewChecklistImport,
  commitChecklistImport,
  loadTemplateDetail,
  addCrosswalkMapping,
  removeCrosswalkMapping,
  setCrosswalkMode,
  type ParsedSheet,
  type ImportColumnMapping,
} from "../actions";

const KIND_LABEL: Record<TemplateKind, string> = {
  nurock_standard: "Canonical",
  investor: "Investor",
  lender: "Lender",
  underwriter: "Underwriter",
  custom: "Custom",
};
const KIND_BADGE: Record<TemplateKind, "navy" | "tan" | "slate" | "green"> = {
  nurock_standard: "navy",
  investor: "green",
  lender: "tan",
  underwriter: "slate",
  custom: "slate",
};
const NONE = "__none__";

export function TemplatesAdmin({
  templates,
  canonicalItems,
}: {
  templates: TemplateSummary[];
  canonicalItems: CanonicalItemLite[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  function retire(t: TemplateSummary) {
    if (!confirm(`Retire "${t.name}"? It will no longer be adoptable by deals.`))
      return;
    deactivateDiligenceTemplate({ templateId: t.id }).then((res) => {
      if (res.error) toast.error(res.error);
      else {
        toast.success("Template retired");
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-nurock-navy/5 rounded-md p-2 border border-nurock-navy/10">
            <ClipboardList className="w-5 h-5 text-nurock-navy" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-nurock-black">
              Diligence Templates
            </h1>
            <p className="text-xs text-nurock-slate-light mt-0.5">
              The NuRock standard checklist plus investor/lender packets. Map
              each packet&apos;s items to your standard items so coverage rolls
              up automatically.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Import checklist
          </Button>
          <Button
            size="sm"
            className="h-8 bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New template
          </Button>
        </div>
      </div>

      <Card className="bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-nurock-slate-light border-b border-nurock-border">
              <th className="px-5 py-2 font-display font-medium">Template</th>
              <th className="px-3 py-2 font-display font-medium">Type</th>
              <th className="px-3 py-2 font-display font-medium">Financier</th>
              <th className="px-3 py-2 font-display font-medium text-right">
                Items
              </th>
              <th className="px-5 py-2 font-display font-medium text-right" />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr
                key={t.id}
                className="border-b border-nurock-border/60 last:border-0 hover:bg-nurock-gray/20 cursor-pointer"
                onClick={() => setDetailId(t.id)}
              >
                <td className="px-5 py-2.5 text-nurock-black font-medium">
                  {t.name}
                  {t.isCanonical && (
                    <span className="ml-2 text-[10px] text-nurock-slate-light">
                      (standard)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={KIND_BADGE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
                </td>
                <td className="px-3 py-2.5 text-nurock-slate">
                  {t.financierName ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-nurock-slate">
                  {t.itemCount}
                </td>
                <td
                  className="px-5 py-2.5 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!t.isCanonical && (
                    <button
                      onClick={() => retire(t)}
                      className="p-1 text-red-700 hover:bg-red-50 rounded"
                      title="Retire template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <DetailDrawer
        templateId={detailId}
        canonicalItems={canonicalItems}
        onClose={() => setDetailId(null)}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Manual create
// -----------------------------------------------------------------------------
function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<TemplateKind>("lender");
  const [financier, setFinancier] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pending, start] = React.useTransition();

  function submit() {
    if (!name.trim()) {
      toast.error("Template name is required.");
      return;
    }
    start(async () => {
      const res = await createDiligenceTemplate({
        name,
        kind,
        financierName: financier || null,
        description: description || null,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Template created");
      setName("");
      setFinancier("");
      setDescription("");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New diligence template</DialogTitle>
          <DialogDescription>
            Create an empty investor/lender packet. Add items by importing a
            checklist into it, or map its items afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 my-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Name *</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
              placeholder="e.g. Cinnaire LP Closing Checklist"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as TemplateKind)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="lender">Lender</SelectItem>
                  <SelectItem value="underwriter">Underwriter</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Financier</Label>
              <input
                value={financier}
                onChange={(e) => setFinancier(e.target.value)}
                className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                placeholder="e.g. Cinnaire"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending}
            className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Import wizard
// -----------------------------------------------------------------------------
function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [sheet, setSheet] = React.useState<ParsedSheet | null>(null);
  const [pending, start] = React.useTransition();

  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<TemplateKind>("lender");
  const [financier, setFinancier] = React.useState("");
  const [titleCol, setTitleCol] = React.useState<string>("0");
  const [categoryCol, setCategoryCol] = React.useState<string>(NONE);
  const [descCol, setDescCol] = React.useState<string>(NONE);
  const [codeCol, setCodeCol] = React.useState<string>(NONE);

  function reset() {
    setFile(null);
    setSheet(null);
    setName("");
    setFinancier("");
    setTitleCol("0");
    setCategoryCol(NONE);
    setDescCol(NONE);
    setCodeCol(NONE);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function parse() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await previewChecklistImport(fd);
      if (res.error || !res.sheet) {
        toast.error(res.error ?? "Could not parse file");
        return;
      }
      setSheet(res.sheet);
      // Heuristic default: pick a column whose header looks like a title.
      const idx = res.sheet.headers.findIndex((h) =>
        /item|document|description|requirement|title|name/i.test(h)
      );
      setTitleCol(String(idx >= 0 ? idx : 0));
    });
  }

  function commit() {
    if (!sheet) return;
    if (!name.trim()) {
      toast.error("Give the template a name.");
      return;
    }
    const mapping: ImportColumnMapping = {
      title: Number(titleCol),
      category: categoryCol === NONE ? null : Number(categoryCol),
      description: descCol === NONE ? null : Number(descCol),
      code: codeCol === NONE ? null : Number(codeCol),
    };
    start(async () => {
      const res = await commitChecklistImport({
        name,
        kind,
        financierName: financier || null,
        rows: sheet.rows,
        mapping,
        source: file?.name.toLowerCase().endsWith(".csv")
          ? "import_csv"
          : "import_excel",
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Imported ${res.itemCount} items`);
      close(false);
      router.refresh();
    });
  }

  const colOptions = (sheet?.headers ?? []).map((h, i) => ({
    value: String(i),
    label: h,
  }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import a checklist</DialogTitle>
          <DialogDescription>
            Upload a lender or investor checklist (.xlsx or .csv), then map its
            columns to template fields.
          </DialogDescription>
        </DialogHeader>

        {!sheet ? (
          <div className="space-y-3 my-2">
            <FileDropZone
              file={file}
              onFileChange={setFile}
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              acceptLabel="Excel or CSV"
              maxBytes={15 * 1024 * 1024}
            />
            <Button
              onClick={parse}
              disabled={!file || pending}
              className="w-full bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Parse file"
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 my-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Template name *</Label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                  placeholder="e.g. Citibank Construction DD"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Financier</Label>
                <input
                  value={financier}
                  onChange={(e) => setFinancier(e.target.value)}
                  className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                  placeholder="e.g. Citibank"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="lender">Lender</SelectItem>
                  <SelectItem value="underwriter">Underwriter</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-nurock-border p-3 space-y-2.5">
              <div className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light">
                Map columns
              </div>
              <ColMap label="Item title *" value={titleCol} onChange={setTitleCol} options={colOptions} allowNone={false} />
              <ColMap label="Category / section" value={categoryCol} onChange={setCategoryCol} options={colOptions} />
              <ColMap label="Description" value={descCol} onChange={setDescCol} options={colOptions} />
              <ColMap label="Code / reference" value={codeCol} onChange={setCodeCol} options={colOptions} />
            </div>

            <div className="text-[11px] text-nurock-slate-light">
              {sheet.rows.length} rows detected. Preview of first 3:
            </div>
            <div className="rounded border border-nurock-border overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody>
                  {sheet.rows.slice(0, 3).map((r, ri) => (
                    <tr key={ri} className="border-b border-nurock-border/60 last:border-0">
                      <td className="px-2 py-1 text-nurock-black">
                        {r[Number(titleCol)] || (
                          <span className="text-red-600">·empty·</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sheet && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setSheet(null)}>
              Back
            </Button>
            <Button
              onClick={commit}
              disabled={pending}
              className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Import items"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ColMap({
  label,
  value,
  onChange,
  options,
  allowNone = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allowNone?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-nurock-slate">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[12px] w-[260px]">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>— none —</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Template detail + crosswalk editor
// -----------------------------------------------------------------------------
function DetailDrawer({
  templateId,
  canonicalItems,
  onClose,
}: {
  templateId: string | null;
  canonicalItems: CanonicalItemLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<TemplateDetail | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async (id: string) => {
    const d = await loadTemplateDetail(id);
    setDetail(d);
  }, []);

  React.useEffect(() => {
    if (!templateId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    refresh(templateId).finally(() => setLoading(false));
  }, [templateId, refresh]);

  const canonicalById = React.useMemo(
    () => new Map(canonicalItems.map((c) => [c.id, c])),
    [canonicalItems]
  );

  // external item id → { canonicalIds, mode }
  const mapByExternal = React.useMemo(() => {
    const m = new Map<string, { canonical: string[]; mode: "all" | "any" }>();
    for (const x of detail?.crosswalk ?? []) {
      const e = m.get(x.externalItemId) ?? { canonical: [], mode: x.mode };
      e.canonical.push(x.canonicalItemId);
      e.mode = x.mode;
      m.set(x.externalItemId, e);
    }
    return m;
  }, [detail]);

  function afterMutation() {
    if (templateId) refresh(templateId);
    router.refresh();
  }

  async function addMap(externalItemId: string, canonicalItemId: string) {
    const res = await addCrosswalkMapping({ canonicalItemId, externalItemId });
    if (res.error) toast.error(res.error);
    else afterMutation();
  }
  async function removeMap(externalItemId: string, canonicalItemId: string) {
    const res = await removeCrosswalkMapping({ canonicalItemId, externalItemId });
    if (res.error) toast.error(res.error);
    else afterMutation();
  }
  async function changeMode(externalItemId: string, mode: "all" | "any") {
    const res = await setCrosswalkMode({ externalItemId, mode });
    if (res.error) toast.error(res.error);
    else afterMutation();
  }

  const isCanonical = detail?.template.isCanonical ?? false;

  return (
    <Sheet open={!!templateId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[680px] overflow-y-auto">
        <SheetHeader className="pr-10">
          <SheetTitle className="font-display text-lg text-nurock-black">
            {detail?.template.name ?? "Template"}
          </SheetTitle>
          <SheetDescription>
            {isCanonical
              ? "The NuRock standard checklist. External packets map to these items."
              : "Map each item to the NuRock-standard item(s) that satisfy it. Coverage for this packet is computed from those mappings."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-nurock-slate-light">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading…
            </div>
          ) : !detail ? (
            <div className="py-12 text-center text-sm text-nurock-slate-light">
              Template not found.
            </div>
          ) : (
            <div className="space-y-2">
              {detail.items.map((item) => {
                const mapping = mapByExternal.get(item.id);
                const mapped = mapping?.canonical ?? [];
                const suggestions = isCanonical
                  ? []
                  : suggestCanonicalMatches(
                      item.title,
                      canonicalItems.map((c) => ({ id: c.id, title: c.title }))
                    ).filter((s) => !mapped.includes(s.id));

                return (
                  <div
                    key={item.id}
                    className="rounded-md border border-nurock-border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13px] text-nurock-black">
                        {item.code && (
                          <span className="font-mono text-[11px] text-nurock-slate-light mr-1.5">
                            {item.code}
                          </span>
                        )}
                        {item.title}
                        <span className="ml-2 text-[10px] text-nurock-slate-light">
                          {categoryLabel(item.category)}
                        </span>
                      </div>
                    </div>

                    {!isCanonical && (
                      <div className="mt-2 space-y-2">
                        {/* Mapped canonical chips */}
                        {mapped.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {mapped.map((cid) => (
                              <span
                                key={cid}
                                className="inline-flex items-center gap-1 rounded-full bg-nurock-navy/[0.06] border border-nurock-navy/15 px-2 py-0.5 text-[11px] text-nurock-navy"
                              >
                                <Link2 className="w-3 h-3" />
                                {canonicalById.get(cid)?.title ?? "item"}
                                <button
                                  onClick={() => removeMap(item.id, cid)}
                                  className="text-nurock-slate-light hover:text-red-600"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                            {mapped.length > 1 && (
                              <span className="inline-flex items-center gap-1 text-[10.5px]">
                                <button
                                  onClick={() =>
                                    changeMode(
                                      item.id,
                                      mapping?.mode === "any" ? "all" : "any"
                                    )
                                  }
                                  className="rounded border border-nurock-border px-1.5 py-0.5 text-nurock-slate hover:bg-nurock-gray"
                                  title="How mapped items combine"
                                >
                                  needs {mapping?.mode === "any" ? "ANY" : "ALL"}
                                </button>
                              </span>
                            )}
                          </div>
                        )}

                        {/* Suggestions */}
                        {suggestions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-nurock-tan-dark" />
                            {suggestions.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => addMap(item.id, s.id)}
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-nurock-tan-dark/50 bg-nurock-tan/10 px-2 py-0.5 text-[11px] text-nurock-tan-dark hover:bg-nurock-tan/20"
                                title={`Suggested match (${Math.round(s.score * 100)}%)`}
                              >
                                <Plus className="w-3 h-3" />
                                {canonicalById.get(s.id)?.title ?? "item"}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Add picker */}
                        <Select
                          value={NONE}
                          onValueChange={(v) => {
                            if (v !== NONE) addMap(item.id, v);
                          }}
                        >
                          <SelectTrigger className="h-8 text-[12px] w-full">
                            <SelectValue placeholder="+ Map to a NuRock-standard item…">
                              + Map to a NuRock-standard item…
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {canonicalItems
                              .filter((c) => !mapped.includes(c.id))
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.itemNumber} · {c.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
