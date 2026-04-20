"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewPRButton({ repo, prNumber }: { repo: string; prNumber: number }) {
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
        body: JSON.stringify({ type: "review", repo, prNumber }),
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
        className="px-2 py-0.5 text-xs rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50"
      >
        {loading ? "..." : "Review"}
      </button>
      {error && <span className="text-xs text-red-400 ml-2">{error}</span>}

      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">Review PR #{prNumber}?</h3>
            <p className="text-sm text-gray-400 mb-5">
              The review agent will read the PR diff, analyze the changes, and post a review comment on GitHub.
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
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium"
              >
                Review
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
