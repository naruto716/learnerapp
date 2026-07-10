"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";

export const masteryBottomFadeStyle: CSSProperties = {
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)",
  maskImage: "linear-gradient(to bottom, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)",
};

export function MasteryCardFrame({
  children,
  maxWidthClassName = "max-w-[760px]",
}: {
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <article
      className={`mx-auto flex h-[min(640px,calc(100vh-190px))] min-h-[460px] w-full ${maxWidthClassName} flex-col rounded-2xl bg-[#202020]/94 p-5 shadow-[0_18px_52px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.08]`}
    >
      {children}
    </article>
  );
}

export function MasteryCardNavigation({
  canNext,
  canPrevious,
  current,
  next,
  previous,
  total,
}: {
  canNext: boolean;
  canPrevious: boolean;
  current: number;
  next: () => void;
  previous: () => void;
  total: number;
}) {
  return (
    <footer className="mt-4 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <button
          aria-label="Previous card"
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/68 hover:bg-white/[0.07] hover:text-white/90 disabled:pointer-events-none disabled:opacity-30"
          disabled={!canPrevious}
          onClick={previous}
          type="button"
        >
          <CaretLeftIcon size={16} />
          Back
        </button>
        <span className="text-xs text-white/34">{current} / {total}</span>
        <button
          aria-label="Next card"
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/68 hover:bg-white/[0.07] hover:text-white/90 disabled:pointer-events-none disabled:opacity-30"
          disabled={!canNext}
          onClick={next}
          type="button"
        >
          Next
          <CaretRightIcon size={16} />
        </button>
      </div>
    </footer>
  );
}
