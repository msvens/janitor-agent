"use client";

import { useEffect, useState } from "react";
import { PlayIcon, StopIcon } from "@heroicons/react/24/solid";

export function AutopilotBanner() {
  const [active, setActive] = useState(false);
  const [jobRunning, setJobRunning] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/autopilot");
        const data = await res.json();
        setActive(data.active);
        setJobRunning(data.jobRunning);
      } catch {
        // ignore
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  async function toggle() {
    setToggling(true);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: active ? "stop" : "start" }),
      });
      const data = await res.json();
      setActive(data.active);
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  }

  if (!active) {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <span className="text-sm text-gray-500">Auto-pilot off</span>
        <button
          onClick={toggle}
          disabled={toggling}
          className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50"
        >
          <PlayIcon className="w-3 h-3" />
          {toggling ? "Starting..." : "Start Auto-pilot"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-green-900/30 border-b border-green-800/50">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <span className="text-sm text-green-300 font-medium">
          Auto-pilot active
          {jobRunning && " — running job..."}
        </span>
      </div>
      <button
        onClick={toggle}
        disabled={toggling}
        className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50"
      >
        <StopIcon className="w-3 h-3" />
        {toggling ? "Stopping..." : "Stop"}
      </button>
    </div>
  );
}
