"use client";

import type { ReactNode } from "react";

export default function IconButton({
  ariaLabel,
  className = "",
  icon,
  onClick,
}: {
  ariaLabel: string;
  className?: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 transition-colors duration-200 ${className}`}
    >
      {icon}
    </button>
  );
}
