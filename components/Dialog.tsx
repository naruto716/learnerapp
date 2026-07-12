"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import IconButton from "./IconButton";

const openDialogStack: symbol[] = [];

export default function Dialog({
  display,
  footer,
  headerActions,
  headerClassName = "mb-4",
  keepMounted = false,
  onClose,
  open,
  overlayClassName = "fixed inset-0",
  panelClassName = "max-w-sm",
  title,
}: {
  display: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  headerClassName?: string;
  keepMounted?: boolean;
  onClose: () => void;
  open: boolean;
  overlayClassName?: string;
  panelClassName?: string;
  title: ReactNode;
}) {
  const titleId = useId();
  const dialogIdRef = useRef(Symbol("dialog"));
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;
    const dialogId = dialogIdRef.current;
    openDialogStack.push(dialogId);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openDialogStack[openDialogStack.length - 1] !== dialogId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      const stackIndex = openDialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if ((!open && !keepMounted) || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={`app-no-drag z-[70] items-center justify-center bg-black/50 px-4 backdrop-blur-sm ${open ? "flex" : "hidden"} ${overlayClassName}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full rounded-lg border border-white/10 bg-[#242424] p-4 shadow-xl ${panelClassName}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-3 ${headerClassName}`}>
          <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium">
            {title}
          </h2>
          {headerActions}
          <IconButton ariaLabel="Close" icon={<XIcon size={16} />} onClick={onClose} />
        </div>

        <div className="min-h-0">{display}</div>

        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
