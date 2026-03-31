"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayIcon } from "@heroicons/react/24/outline";

export function RunTaskButton({ taskId, repo }: { taskId: string; repo: string }) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setConfirming(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "action", repo, taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start");
        return;
      }
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        title="Run this task"
        className="p-1 text-gray-500 hover:text-blue-400 rounded disabled:opacity-50"
      >
        <PlayIcon className="w-4 h-4" />
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}

      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">Run this task?</h3>
            <p className="text-sm text-gray-400 mb-5">
              This will execute the task, run tests, and create a PR if successful.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
