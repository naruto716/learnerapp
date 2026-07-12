"use client";

import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";

const subscribeToPlatform = () => () => {};

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isWindows = useSyncExternalStore(
    subscribeToPlatform,
    () => window.learner?.platform === "win32",
    () => false,
  );

  useEffect(() => {
    return window.learner?.onMaximizedChange(setIsMaximized);
  }, []);

  if (!isWindows) return null;

  return (
    <div className="app-no-drag relative flex h-full shrink-0 items-stretch pl-7">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-transparent to-[#242424]"
      />
      <button
        aria-label="Minimize window"
        className="relative flex w-11 items-center justify-center text-white/48 transition hover:bg-white/[0.08] hover:text-white/82"
        onClick={() => void window.learner?.minimizeWindow()}
        type="button"
      >
        <MinusIcon size={15} />
      </button>
      <button
        aria-label="Maximize or restore window"
        className="relative flex w-11 items-center justify-center text-white/48 transition hover:bg-white/[0.08] hover:text-white/82"
        onClick={() => void window.learner?.toggleMaximizeWindow().then(setIsMaximized)}
        type="button"
      >
        {isMaximized ? <CopyIcon size={14} /> : <SquareIcon size={13} />}
      </button>
      <button
        aria-label="Close window"
        className="relative flex w-11 items-center justify-center text-white/48 transition hover:bg-red-500 hover:text-white"
        onClick={() => void window.learner?.closeWindow()}
        type="button"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}
