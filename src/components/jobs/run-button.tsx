"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JobType } from "@/lib/job-manager";

const descriptions: Record<JobType, string> = {
  plan: "This will use Claude to survey the repo and generate maintenance tasks. It costs ~$0.30-0.70 per repo.",
  action: "This will pick the next pending task and execute it (make edits, run tests, create PR).",
  reconcile: "This will check open PRs for status changes and handle review comments.",
};

export function RunButton({
  type,
  repo,
  label,
  className = "",
}: {
  type: JobType;
  repo?: string;
  label: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    setConfirming(true);
  }

  async function handleConfirm() {
    setConfirming(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, repo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start job");
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
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${className || "bg-blue-600 hover:bg-blue-500 text-white"}`}
      >
        {loading ? "Starting..." : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">
              Start {type} job{repo ? ` for ${repo}` : ""}?
            </h3>
            <p className="text-sm text-gray-400 mb-5">
              {descriptions[type]}
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
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
