"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      closeButton
      position="bottom-right"
      richColors
      theme="dark"
      toastOptions={{
        classNames: {
          toast: "app-no-drag border-white/10 bg-[#242424] text-white",
        },
      }}
    />
  );
}