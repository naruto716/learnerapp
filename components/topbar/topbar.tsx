"use client";

import IconButton from "../IconButton";
import { CaretLeftIcon, CaretRightIcon, SidebarIcon } from "@phosphor-icons/react";
import { useRouter } from "next/dist/client/components/navigation";

export default function TopBar({ isSidebarOpen, toggleSidebar }: { isSidebarOpen: boolean; toggleSidebar: () => void }) {
    const isMac = typeof window !== "undefined" && window.learner?.platform === "darwin";
    const router = useRouter();
    return (
        <div className="app-drag w-full h-8 bg-white/5 flex items-center pr-2 gap-4 border-b border-white/10">
            <div className={`${!isSidebarOpen && isMac ? 'w-18' : 'w-0'} transition-all duration-300 ease-in-out`}></div>
            <div className="flex items-center gap-1">
                <IconButton
                    ariaLabel="Toggle sidebar"
                    icon={<SidebarIcon size={22} />}
                    onClick={toggleSidebar}
                />
                <IconButton 
                    ariaLabel="Back"
                    icon={<CaretLeftIcon size={22} />}
                    onClick={router.back}
                />
                <IconButton 
                    ariaLabel="Forward"
                    icon={<CaretRightIcon size={22} />}
                    onClick={router.forward}
                />
            </div>
        </div>
    );
}
