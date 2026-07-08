"use client";

import type { ReactNode } from "react";

export default function FloatingIconButton({
  ariaLabel,
  className = "",
  disabled = false,
  icon,
  onClick,
  tooltip = ariaLabel,
  size = 8,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  tooltip?: string;
  size?: number;
}) {
  return (
    <div className={`app-no-drag group fixed z-50 ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        className={`flex h-${size || 8} w-${size || 8} items-center justify-center rounded-full bg-white/10 text-white/70 border border-white/15 ring-1 ring-white/[0.08] backdrop-blur-xl transition hover:bg-[#232323]/90 hover:text-white disabled:cursor-default disabled:text-white/30 disabled:hover:bg-white/20`}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white/72 opacity-0 shadow-lg ring-1 ring-white/[0.08] backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}
