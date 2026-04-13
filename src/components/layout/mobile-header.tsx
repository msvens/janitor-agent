"use client";

import { useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { MobileNav } from "./mobile-nav";
import { AutopilotButton } from "./autopilot-button";

export function MobileHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex md:hidden items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
      <h1 className="text-lg font-semibold text-gray-100">Janitor Agent</h1>
      <div className="flex items-center gap-2">
        <AutopilotButton compact />
        <button
          onClick={() => setIsOpen(true)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
        >
          <Bars3Icon className="w-6 h-6" />
        </button>
      </div>
      <MobileNav isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}
