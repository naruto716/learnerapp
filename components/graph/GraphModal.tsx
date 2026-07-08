"use client";

import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export default function GraphModal({
  children,
  footer,
  onClose,
  open,
  subtitle,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  subtitle?: string;
  title: string;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-5 backdrop-blur-[2px]">
      <section className="flex max-h-[min(720px,calc(100vh-8rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-[#171717]/96 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.1] backdrop-blur-[24px]">
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-6 text-white/92">{title}</h2>
            {subtitle && <p className="mt-1 text-sm leading-5 text-white/42">{subtitle}</p>}
          </div>
          <button
            aria-label="Close dialog"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/46 transition hover:bg-white/[0.08] hover:text-white/85"
            onClick={onClose}
            type="button"
          >
            <XIcon size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-2">{children}</div>

        {footer && <footer className="flex shrink-0 justify-end gap-2 px-5 pb-5 pt-3">{footer}</footer>}
      </section>
    </div>
  );
}
