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
      className="app-no-drag flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 transition-colors duration-200"
    >
      {icon}
    </button>
  );
}
