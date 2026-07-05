"use client";

import type { ReactNode } from "react";

export default function IconButton({
  ariaLabel,
  icon,
  onClick,
}: {
  ariaLabel: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className="app-no-drag flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/10 transition-colors duration-200"
    >
      {icon}
    </button>
  );
}
