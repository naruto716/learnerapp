"use client";

import { CaretLeftIcon, CaretRightIcon, SidebarIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import IconButton from "../IconButton";
import { documentTitle } from "../documentPaths";

export default function TopBar({
  activeDocumentPath,
  isSidebarOpen,
  onSelectTab,
  openTabs,
  toggleSidebar,
}: {
  activeDocumentPath: string | null;
  isSidebarOpen: boolean;
  onSelectTab: (documentPath: string) => void;
  openTabs: string[];
  toggleSidebar: () => void;
}) {
  const router = useRouter();

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

      <div className="app-no-drag flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto">
        {openTabs.map((documentPath, index, array) => (
          <button
            key={documentPath}
            type="button"
            onClick={() => onSelectTab(documentPath)}
            className={`min-w-36 max-w-56 truncate border-l ${index === array.length - 1 ? "border-r" : ""} border-white/10 px-4 text-left text-sm ${
              activeDocumentPath === documentPath
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            {documentTitle(documentPath)}
          </button>
        ))}
      </div>
    </div>
  );
}
