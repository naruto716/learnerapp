"use client";

import { useEffect, useState } from "react";
import SideBar from "@/components/sidebar/sidebar";
import TopBar from "@/components/topbar/topbar";
import { DocumentProvider } from "@/components/DocumentContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedDocumentPath, setSelectedDocumentPath] = useState<string | null>(null);

  useEffect(() => {
    const platform = window.learner?.platform ?? navigator.platform.toLowerCase();
    document.documentElement.dataset.platform = platform === "darwin" || platform.includes("mac") ? "darwin" : platform;
  }, []);

  return (
    <DocumentProvider value={{ selectedDocumentPath, setSelectedDocumentPath }}>
      <div className="flex">
        <SideBar isSidebarOpen={isSidebarOpen} />
        <div className="flex-1">
          <TopBar isSidebarOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen((isOpen) => !isOpen)} />
          <main className="p-4">{children}</main>
        </div>
      </div>
    </DocumentProvider>
  );
}
