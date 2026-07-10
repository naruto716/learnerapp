"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import IconButton from "./IconButton";

export default function Dialog({
  display,
  footer,
  onClose,
  open,
  overlayClassName = "fixed inset-0",
  panelClassName = "max-w-sm",
  title,
}: {
  display: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  overlayClassName?: string;
  panelClassName?: string;
  title: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`app-no-drag z-[70] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm ${overlayClassName}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full rounded-lg border border-white/10 bg-[#242424] p-4 shadow-xl ${panelClassName}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          <IconButton ariaLabel="Close" icon={<XIcon size={16} />} onClick={onClose} />
        </div>

        <div>{display}</div>

        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
