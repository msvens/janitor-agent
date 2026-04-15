"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

export function ResetTaskButton({ taskId, repo }: { taskId: string; repo: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleReset() {
    setLoading(true);
    try {
      const repoParam = repo.replace("/", "-");
      await fetch(`/api/backlogs/${repoParam}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleReset}
      disabled={loading}
      title="Reset to pending"
      className="p-1 text-gray-500 hover:text-yellow-400 rounded disabled:opacity-50"
    >
      <ArrowPathIcon className="w-4 h-4" />
    </button>
  );
}
