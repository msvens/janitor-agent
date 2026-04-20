"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

export function ReconcileStatus() {
  const [status, setStatus] = useState<"starting" | "running" | "done" | "error" | "busy">("starting");
  const [logs, setLogs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      try {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "reconcile" }),
        });

        if (res.status === 409) {
          setStatus("busy");
          return;
        }

        if (!res.ok) {
          setStatus("error");
          return;
        }

        const { jobId } = await res.json();
        setStatus("running");

        const evtSource = new EventSource(`/api/jobs/${jobId}/stream`);
        evtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.message) {
              setLogs((prev) => [...prev, data.message]);
            }
            if (data.status === "completed" || data.status === "failed" || data.status === "aborted") {
              setStatus("done");
              evtSource.close();
              setTimeout(() => {
                setExpanded(false);
                router.refresh();
              }, 1500);
            }
          } catch { /* ignore parse errors */ }
        };
        evtSource.onerror = () => {
          setStatus("done");
          evtSource.close();
          router.refresh();
        };
      } catch {
        setStatus("error");
      }
    }

    run();
  }, [router]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (status === "done" && logs.length === 0) return null;

  return (
    <div className="mb-4 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-800/50"
      >
        <span className="flex items-center gap-2">
          {(status === "starting" || status === "running") && (
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          )}
          {status === "done" && <span className="w-2 h-2 rounded-full bg-green-400" />}
          {status === "error" && <span className="w-2 h-2 rounded-full bg-red-400" />}
          {status === "busy" && <span className="w-2 h-2 rounded-full bg-yellow-400" />}
          <span className="text-gray-300">
            {status === "starting" && "Starting reconcile..."}
            {status === "running" && "Reconciling PRs..."}
            {status === "done" && "Reconcile complete"}
            {status === "error" && "Reconcile failed"}
            {status === "busy" && "Another job is running"}
          </span>
        </span>
        <span className="text-gray-600 text-xs">{expanded ? "collapse" : "expand"}</span>
      </button>
      {expanded && logs.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-2 max-h-60 overflow-y-auto text-xs font-mono text-gray-400 space-y-0.5">
          {logs.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}