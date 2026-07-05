"use client";

import { useState } from "react";
import SideBar from "@/components/sidebar/sidebar";
import TopBar from "@/components/topbar/topbar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex">
      <SideBar isSidebarOpen={isSidebarOpen} />
      <div className="flex-1">
        <TopBar isSidebarOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen((isOpen) => !isOpen)} />
        <main className="p-4">{children}</main>
      </div>
    </div>
  );
}
