"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XMarkIcon } from "@heroicons/react/24/outline";

export function DismissTaskButton({ taskId, repo }: { taskId: string; repo: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleDismiss() {
    setSaving(true);
    try {
      const repoParam = repo.replace("/", "-");
      await fetch(`/api/backlogs/${repoParam}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped", skip_reason: reason || undefined }),
      });
      setConfirming(false);
      router.refresh();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Dismiss this task"
        className="p-1 text-gray-500 hover:text-red-400 rounded"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>

      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">Dismiss this task?</h3>
            <p className="text-sm text-gray-400 mb-4">
              The planner will learn not to suggest similar tasks.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional) — e.g., 'Already handled manually', 'Not applicable'"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-y min-h-[60px] mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setConfirming(false); setReason(""); }}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleDismiss}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50"
              >
                {saving ? "Dismissing..." : "Dismiss"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
