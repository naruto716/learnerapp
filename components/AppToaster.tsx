"use client";

// AppToaster mounts the global notification surface used by feature controllers.
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
