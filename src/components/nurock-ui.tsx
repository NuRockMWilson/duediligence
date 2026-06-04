"use client";

import * as React from "react";

// ============================================================================
// NuRock UI Primitives — shared across all tabs
// ----------------------------------------------------------------------------
// Self-contained. No globals.css dependency. All structural styling is inline
// Tailwind utilities so these render correctly regardless of CSS file state.
//
// Requires from tailwind.config.ts:
//   - colors.nurock.{navy, navy-dark, navy-light, tan, tan-light, tan-dark,
//     black, slate, slate-light, gray, offwhite, border}
//   - fontFamily.{display: ["Oswald", ...], body: ["Inter", ...],
//     mono: ["JetBrains Mono", ...]}
// ============================================================================

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[10px] border border-[#E4E7EC] bg-white shadow-[0_1px_2px_0_rgb(16_24_40/0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-[#E4E7EC] px-[18px] py-3.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-display text-[13px] font-semibold uppercase leading-tight tracking-[0.04em] text-nurock-navy">
        {children}
      </div>
      {subtitle && <div className="mt-0.5 text-[11px] text-[#667085]">{subtitle}</div>}
    </div>
  );
}

export function CardBody({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`px-[18px] py-4 ${className}`}>{children}</div>;
}

// -----------------------------------------------------------------------------
// KPI Tile
// -----------------------------------------------------------------------------

export type AccentTone = "tan" | "navy" | "green" | "amber" | "red";

export function KpiTile({
  label,
  value,
  sub,
  tone = "tan",
  valueSuffix,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: AccentTone;
  valueSuffix?: React.ReactNode;
}) {
  const accent: Record<AccentTone, string> = {
    tan: "bg-nurock-tan",
    navy: "bg-nurock-navy",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  };
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-[#E4E7EC] bg-white px-[15px] py-[13px]">
      <div className={`absolute left-0 top-0 h-full w-[3px] ${accent[tone]}`} />
      <div className="font-display text-[10px] font-medium uppercase tracking-[0.08em] text-nurock-slate">
        {label}
      </div>
      <div className="mt-0.5 font-display text-[22px] font-semibold tabular-nums leading-none -tracking-[0.01em] text-nurock-black">
        {value}
        {valueSuffix}
      </div>
      <div className="mt-1 text-[11px] leading-[1.35] text-[#667085]">{sub}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

export type BadgeTone = "green" | "amber" | "red" | "navy" | "slate" | "tan";

export function Badge({
  tone,
  children,
  className = "",
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const styles: Record<BadgeTone, string> = {
    green: "bg-[#ECFDF3] text-[#027A48]",
    amber: "bg-[#FFFAEB] text-[#B54708]",
    red: "bg-[#FEF3F2] text-[#B42318]",
    navy: "bg-[#EFF4FB] text-nurock-navy",
    slate: "bg-[#F2F4F7] text-nurock-slate",
    tan: "bg-[#F5F3ED] text-[#8F8A6F]",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-display text-[10.5px] font-semibold uppercase leading-[1.4] tracking-[0.02em] ${styles[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Bar Track + Fill
// -----------------------------------------------------------------------------

export function BarTrack({
  children,
  className = "h-1.5",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-full bg-[#F2F4F7] ${className}`}>
      {children}
    </div>
  );
}

export type BarFillTone = "navy" | "tan" | "over" | "under";

export function BarFill({
  width,
  tone = "navy",
}: {
  width: number;
  tone?: BarFillTone;
}) {
  if (width <= 0) return null;
  const grad: Record<BarFillTone, string> = {
    navy: "bg-gradient-to-r from-nurock-navy to-nurock-navy-light",
    tan: "bg-gradient-to-r from-nurock-tan to-nurock-tan-light",
    over: "bg-gradient-to-r from-[#B42318] to-[#D92D20]",
    under: "bg-gradient-to-r from-[#027A48] to-[#12B76A]",
  };
  return (
    <div
      className={`h-full transition-[width] duration-500 ${grad[tone]}`}
      style={{ width: `${Math.min(width, 100)}%` }}
    />
  );
}

// -----------------------------------------------------------------------------
// Tab Chip (view switcher)
// -----------------------------------------------------------------------------

export function TabChip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-nurock-navy text-white"
          : "text-nurock-slate hover:bg-[#F2F4F7]"
      }`}
    >
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Code Chip (Sage account / cost-line code)
// -----------------------------------------------------------------------------

export function CodeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[#EFF4FB] px-1.5 py-px font-mono text-[11px] text-nurock-navy">
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Timeline Item (vertical stepper)
// -----------------------------------------------------------------------------

export function TimelineItem({
  status = "future",
  isLast = false,
  children,
}: {
  status?: "done" | "active" | "future";
  isLast?: boolean;
  children: React.ReactNode;
}) {
  const dot = {
    done: "bg-emerald-500 border-emerald-500",
    active: "bg-nurock-navy border-nurock-navy ring-[3px] ring-nurock-navy/20",
    future: "bg-white border-[#98A2B3]",
  }[status];
  // pb-2 (was pb-3.5) shaves ~6px per row. Across the 13 LIHTC milestones
  // in the dashboard's Project Schedule card that's ~80px less vertical
  // space — enough to bring the Schedule card's bottom in line with the
  // stacked Budget Burn + Sources & Uses Bridge cards on the left,
  // eliminating the gray dead space at the bottom of the right column.
  return (
    <div className="relative pb-2 pl-[18px]">
      {!isLast && (
        <div className="absolute bottom-0 left-[5px] top-[14px] w-px bg-[#E4E7EC]" />
      )}
      <div className={`absolute left-0.5 top-[5px] h-2 w-2 rounded-full border-2 ${dot}`} />
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Check Row + Check Icon (Co-Pilot validations, checklists)
// -----------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export function CheckIcon({ status }: { status: CheckStatus }) {
  const styles: Record<CheckStatus, string> = {
    pass: "bg-[#D1FADF] text-[#027A48]",
    warn: "bg-[#FEF0C7] text-[#B54708]",
    fail: "bg-[#FEE4E2] text-[#B42318]",
    info: "bg-[#DBEAFE] text-[#1E40AF]",
  };
  const path = {
    pass: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />,
    warn: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    ),
    fail: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />,
    info: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
  }[status];
  return (
    <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${styles[status]}`}>
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {path}
      </svg>
    </div>
  );
}

export function CheckRow({
  status,
  title,
  detail,
  action,
}: {
  status: CheckStatus;
  title: string;
  detail?: string;
  action?: { label: string; onClick?: () => void };
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-[#F2F4F7] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[#FAFBFC]">
      <div className="mt-px">
        <CheckIcon status={status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold leading-snug">{title}</div>
        {detail && <div className="mt-0.5 text-[11px] leading-snug text-[#667085]">{detail}</div>}
        {action && (
          <button
            onClick={action.onClick}
            className="mt-1 text-[11px] font-medium text-nurock-navy hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function CheckSection({
  status,
  count,
  label,
  children,
}: {
  status: CheckStatus;
  count: number;
  label: string;
  children: React.ReactNode;
}) {
  const bgColor: Record<CheckStatus, string> = {
    pass: "bg-emerald-50/50",
    warn: "bg-amber-50/50",
    fail: "bg-red-50/50",
    info: "bg-blue-50/50",
  };
  const textColor: Record<CheckStatus, string> = {
    pass: "text-emerald-700",
    warn: "text-amber-700",
    fail: "text-red-700",
    info: "text-blue-700",
  };
  return (
    <>
      <div className={`px-4 py-2 ${bgColor[status]}`}>
        <div className={`font-display text-[10px] font-semibold uppercase tracking-wider ${textColor[status]}`}>
          {label} ({count})
        </div>
      </div>
      {children}
    </>
  );
}

// -----------------------------------------------------------------------------
// File Icon (file-type chip for document lists)
// -----------------------------------------------------------------------------

export type FileType = "pdf" | "xls" | "doc" | "img" | "csv";

export function FileIcon({
  type,
  faded = false,
}: {
  type: FileType;
  faded?: boolean;
}) {
  const bg: Record<FileType, string> = {
    pdf: "bg-[#D92D20]",
    xls: "bg-[#12B76A]",
    doc: "bg-nurock-navy",
    img: "bg-[#7A5AF8]",
    csv: "bg-[#0BA5EC]",
  };
  return (
    <span
      className={`inline-flex h-[30px] w-[26px] flex-shrink-0 items-center justify-center rounded font-display text-[9px] font-semibold uppercase tracking-[0.04em] text-white ${bg[type]} ${faded ? "opacity-50" : ""}`}
    >
      {type}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Circular Progress (score gauge)
// -----------------------------------------------------------------------------

export function CircularProgress({
  value,
  max = 100,
  size = 80,
  strokeWidth = 3,
  tone = "green",
  label,
  sublabel,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  tone?: "green" | "amber" | "red" | "navy";
  label?: React.ReactNode;
  sublabel?: React.ReactNode;
}) {
  const pct = (value / max) * 100;
  const color = {
    green: "#12B76A",
    amber: "#F79009",
    red: "#D92D20",
    navy: "#164576",
  }[tone];
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#E4E7EC" strokeWidth={strokeWidth} />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${pct} 100`}
          strokeLinecap="round"
          pathLength="100"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label !== undefined ? (
          label
        ) : (
          <>
            <div className="font-display text-[22px] font-bold leading-none tabular-nums text-nurock-black">
              {value}
            </div>
            <div className="mt-0.5 font-display text-[8px] font-semibold uppercase leading-none tracking-wider text-[#667085]">
              of {max}
            </div>
          </>
        )}
        {sublabel}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Horizontal Stepper (approval workflow)
// -----------------------------------------------------------------------------

export type StepStatus = "done" | "active" | "future";

export type StepperStep = {
  status: StepStatus;
  title: string;
  subtitle?: string;
  timestamp?: string;
  icon?: React.ReactNode;
};

export function Stepper({ steps }: { steps: StepperStep[] }) {
  // Compute the green line width based on how many steps are done
  const doneCount = steps.filter((s) => s.status === "done").length;
  const completedFraction = doneCount > 0 ? doneCount / (steps.length - 1) : 0;
  const stepWidthPct = 100 / steps.length;
  const greenLineWidthPct = Math.min(completedFraction * 100, 100);

  return (
    <div className="relative flex items-start justify-between">
      {/* Background connector line */}
      <div className="absolute left-[10%] right-[10%] top-5 h-0.5 bg-[#E4E7EC]" />
      {/* Completed connector line */}
      {doneCount > 0 && (
        <div
          className="absolute left-[10%] top-5 h-0.5 bg-emerald-500 transition-[width] duration-500"
          style={{ width: `calc((100% - 20%) * ${greenLineWidthPct / 100})` }}
        />
      )}

      {steps.map((step, i) => {
        const dotStyle =
          step.status === "done"
            ? "bg-emerald-500 text-white shadow-md"
            : step.status === "active"
            ? "bg-nurock-navy text-white shadow-md ring-4 ring-nurock-navy/20"
            : "bg-nurock-gray text-[#667085] border-2 border-[#E4E7EC]";

        const titleColor =
          step.status === "future" ? "text-[#667085]" : "";

        const tsColor =
          step.status === "done"
            ? "text-emerald-700"
            : step.status === "active"
            ? "text-nurock-navy"
            : "text-[#667085]";

        return (
          <div
            key={i}
            className="z-10 flex flex-col items-center"
            style={{ width: `${stepWidthPct}%` }}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${dotStyle}`}>
              {step.status === "done" ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step.icon
              )}
            </div>
            <div className={`mt-1.5 text-[11px] font-semibold ${titleColor}`}>{step.title}</div>
            {step.subtitle && (
              <div className="text-[10.5px] text-[#667085]">{step.subtitle}</div>
            )}
            {step.timestamp && (
              <div className={`text-[10px] font-medium ${tsColor}`}>{step.timestamp}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Table cell helpers (consistent with framework HTML .cell / .cell-head)
// -----------------------------------------------------------------------------

export function CellHead({
  children,
  className = "",
  colSpan,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      colSpan={colSpan}
      className={`whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate text-${align} ${className}`}
    >
      {children}
    </th>
  );
}

export function Cell({
  children,
  className = "",
  colSpan,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2.5 align-middle text-[12.5px] text-${align} ${className}`}
    >
      {children}
    </td>
  );
}
