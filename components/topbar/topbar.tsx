"use client";

import { CaretLeftIcon, CaretRightIcon, SidebarIcon, XIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import IconButton from "../IconButton";
import { documentTitle } from "../documentPaths";

type TabDragTarget = {
  path: string;
  position: "before" | "after";
} | null;

export default function TopBar({
  activeDocumentPath,
  isSidebarOpen,
  onCloseTab,
  onReorderTabs,
  onSelectTab,
  openTabs,
  toggleSidebar,
}: {
  activeDocumentPath: string | null;
  isSidebarOpen: boolean;
  onCloseTab: (documentPath: string) => void;
  onReorderTabs: (sourcePath: string, targetPath: string, position: "before" | "after") => void;
  onSelectTab: (documentPath: string) => void;
  openTabs: string[];
  toggleSidebar: () => void;
}) {
  const router = useRouter();
  const [dragTarget, setDragTarget] = useState<TabDragTarget>(null);

  return (
    <div className="app-drag flex h-10 w-full items-center gap-3 border-b border-white/10 bg-white/5 pr-2">
      <div className={`${!isSidebarOpen ? "mac-traffic-spacer" : "w-0"} shrink-0 transition-all duration-300 ease-in-out`} />
      <div className="app-no-drag flex shrink-0 items-center gap-1">
        <IconButton
          ariaLabel="Toggle sidebar"
          icon={<SidebarIcon size={20} />}
          onClick={toggleSidebar}
        />
        <IconButton
          ariaLabel="Back"
          icon={<CaretLeftIcon size={20} />}
          onClick={router.back}
        />
        <IconButton
          ariaLabel="Forward"
          icon={<CaretRightIcon size={20} />}
          onClick={router.forward}
        />
      </div>

      <div className="scrollbar-hidden flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto">
        {openTabs.map((documentPath, index, array) => (
          <div
            key={documentPath}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-learner-tab", documentPath);
            }}
            onDragEnd={() => setDragTarget(null)}
            onDragLeave={() => {
              if (dragTarget?.path === documentPath) setDragTarget(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              setDragTarget({
                path: documentPath,
                position: x < rect.width / 2 ? "before" : "after",
              });
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourcePath = event.dataTransfer.getData("application/x-learner-tab");
              const position = dragTarget?.path === documentPath ? dragTarget.position : "before";
              setDragTarget(null);
              onReorderTabs(sourcePath, documentPath, position);
            }}
            className={`app-no-drag group relative flex min-w-36 max-w-56 items-center gap-2 border-l ${index === array.length - 1 ? "border-r" : ""} border-white/10 pl-4 pr-2 text-sm transition-colors ${
              activeDocumentPath === documentPath
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white"
            } ${dragTarget?.path === documentPath ? "bg-white/[0.08]" : ""}`}
          >
            {dragTarget?.path === documentPath && dragTarget.position === "before" && (
              <span className="pointer-events-none absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-white/70" />
            )}
            {dragTarget?.path === documentPath && dragTarget.position === "after" && (
              <span className="pointer-events-none absolute bottom-1 right-0 top-1 w-0.5 rounded-full bg-white/70" />
            )}
            <button
              type="button"
              onClick={() => onSelectTab(documentPath)}
              className="min-w-0 flex-1 truncate py-2 text-left"
            >
              {documentTitle(documentPath)}
            </button>
            <IconButton
              ariaLabel={`Close ${documentTitle(documentPath)}`}
              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-60 focus:opacity-100 hover:opacity-100"
              icon={<XIcon size={13} />}
              onClick={() => onCloseTab(documentPath)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
