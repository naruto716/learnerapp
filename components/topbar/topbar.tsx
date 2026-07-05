"use client";

import IconButton from "../IconButton";
import { SidebarIcon } from "@phosphor-icons/react";

export default function TopBar({ toggleSidebar }: { toggleSidebar: () => void }) {
  return (
    <div className="app-drag w-full h-8 bg-white/5 p-4 flex items-center justify-between">
      <IconButton
        ariaLabel="Toggle sidebar"
        icon={<SidebarIcon size={18} />}
        onClick={toggleSidebar}
      />
    </div>
  );
}
