"use client";

import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import IconButton from "./IconButton";

export default function Dialog({
  display,
  footer,
  onClose,
  open,
  title,
}: {
  display: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  if (!open) return null;

  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="w-full max-w-sm rounded-lg border border-white/10 bg-[#242424] p-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="dialog-title" className="text-sm font-medium">
            {title}
          </h2>
          <IconButton ariaLabel="Close" icon={<XIcon size={16} />} onClick={onClose} />
        </div>

        <div>{display}</div>

        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
