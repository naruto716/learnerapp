"use client";

import type { ReactNode } from "react";

export type FloatingIconButtonStatus = "checking" | "not-generated" | "generating" | "ready" | "notes-changed";

const statusStyles: Record<FloatingIconButtonStatus, { button: string; dot: string }> = {
  checking: {
    button: "border-white/12 text-white/42",
    dot: "bg-white/35",
  },
  "not-generated": {
    button: "border-white/15 text-white/55",
    dot: "bg-white/45",
  },
  generating: {
    button: "border-sky-300/45 bg-sky-300/10 text-sky-100",
    dot: "animate-pulse bg-sky-300",
  },
  ready: {
    button: "border-emerald-300/40 bg-emerald-300/[0.08] text-emerald-100",
    dot: "bg-emerald-300",
  },
  "notes-changed": {
    button: "border-amber-300/45 bg-amber-300/[0.08] text-amber-100",
    dot: "bg-amber-300",
  },
};

export default function FloatingIconButton({
  ariaLabel,
  className = "",
  disabled = false,
  icon,
  onClick,
  status,
  tooltip = ariaLabel,
  size = 8,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  status?: FloatingIconButtonStatus;
  tooltip?: string;
  size?: number;
}) {
  const statusStyle = status ? statusStyles[status] : null;

  return (
    <div className={`app-no-drag group fixed z-20 ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        className={`relative flex h-${size || 8} w-${size || 8} items-center justify-center rounded-full bg-white/10 text-white/70 border border-white/15 ring-1 ring-white/[0.08] backdrop-blur-xl transition hover:bg-[#232323]/90 hover:text-white disabled:cursor-default disabled:text-white/30 disabled:hover:bg-white/20 ${statusStyle?.button ?? ""}`}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        {statusStyle && (
          <span
            aria-hidden="true"
            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#1c1c1c] ${statusStyle.dot}`}
          />
        )}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white/72 opacity-0 shadow-lg ring-1 ring-white/[0.08] backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}
