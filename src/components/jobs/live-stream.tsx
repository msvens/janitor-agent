"use client";

import { useEffect, useRef, useState } from "react";

interface LogEntry {
  message: string;
  timestamp: string;
}

export function LiveStream({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [done, setDone] = useState(false);
  const [aborting, setAborting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "done") {
        setDone(true);
        source.close();
        return;
      }
      setLogs((prev) => [...prev, { message: data.message, timestamp: data.timestamp }]);
    };

    source.onerror = () => {
      setDone(true);
      source.close();
    };

    return () => source.close();
  }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function handleAbort() {
    setAborting(true);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          {!done && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
            </span>
          )}
          <span className="text-sm font-medium">
            {done ? "Completed" : "Running..."}
          </span>
        </div>
        {!done && (
          <button
            onClick={handleAbort}
            disabled={aborting}
            className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {aborting ? "Aborting..." : "Abort"}
          </button>
        )}
      </div>
      <div className="p-4 max-h-[600px] overflow-y-auto font-mono text-xs space-y-0.5">
        {logs.length === 0 && !done && (
          <p className="text-gray-500">Waiting for output...</p>
        )}
        {logs.map((log, i) => (
          <div key={i} className="text-gray-300 leading-relaxed">
            <span className="text-gray-600 mr-2">
              {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ""}
            </span>
            {log.message}
          </div>
        ))}
        {done && logs.length > 0 && (
          <div className="text-green-400 mt-2 pt-2 border-t border-gray-800">
            Job finished.
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
