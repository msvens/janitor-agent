"use client";

import { useState } from "react";
import { PlayIcon, StopIcon } from "@heroicons/react/24/solid";
import { useAppStatus } from "@/components/status-provider";

export function AutopilotButton({ compact = false }: { compact?: boolean }) {
  const { autopilotActive: active } = useAppStatus();
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    try {
      await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: active ? "stop" : "start" }),
      });
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  }

  if (active) {
    return (
      <button
        onClick={toggle}
        disabled={toggling}
        className={`flex items-center gap-1.5 rounded-lg font-medium disabled:opacity-50 ${
          compact
            ? "px-2.5 py-1 text-xs bg-red-600 hover:bg-red-500 text-white"
            : "px-3 py-2 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 w-full"
        }`}
      >
        <StopIcon className={compact ? "w-3 h-3" : "w-4 h-4"} />
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        {toggling ? "Stopping..." : "Stop Auto-pilot"}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={toggling}
      className={`flex items-center gap-1.5 rounded-lg font-medium disabled:opacity-50 ${
        compact
          ? "px-2.5 py-1 text-xs bg-green-600 hover:bg-green-500 text-white"
          : "px-3 py-2 text-sm bg-green-600/20 hover:bg-green-600/30 text-green-400 w-full"
      }`}
    >
      <PlayIcon className={compact ? "w-3 h-3" : "w-4 h-4"} />
      {toggling ? "Starting..." : "Start Auto-pilot"}
    </button>
  );
}
