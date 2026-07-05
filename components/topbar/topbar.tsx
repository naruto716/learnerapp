"use client";

import IconButton from "../IconButton";
import { CaretLeftIcon, CaretRightIcon, SidebarIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

export default function TopBar({ isSidebarOpen, toggleSidebar }: { isSidebarOpen: boolean; toggleSidebar: () => void }) {
    const router = useRouter();

    return (
        <div className="app-drag w-full h-10 bg-white/5 flex items-center pr-2 gap-3 border-b border-white/10">
            <div className={`${!isSidebarOpen ? "mac-traffic-spacer" : "w-0"} shrink-0 transition-all duration-300 ease-in-out`} />
            <div className="app-no-drag flex items-center gap-1">
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
        </div>
    );
}
