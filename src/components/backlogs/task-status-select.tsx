"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const statuses = ["pending", "in_progress", "completed", "failed", "skipped"] as const;

const statusColors: Record<string, string> = {
  pending: "text-yellow-400 border-yellow-400/30",
  in_progress: "text-blue-400 border-blue-400/30",
  completed: "text-green-400 border-green-400/30",
  failed: "text-red-400 border-red-400/30",
  skipped: "text-gray-400 border-gray-400/30",
};

export function TaskStatusSelect({
  taskId,
  repo,
  currentStatus,
}: {
  taskId: string;
  repo: string;
  currentStatus: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleChange(newStatus: string) {
    if (newStatus === status) return;
    setSaving(true);
    try {
      const repoParam = repo.replace("/", "-");
      await fetch(`/api/backlogs/${repoParam}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setStatus(newStatus);
      router.refresh();
    } catch {
      // revert on error
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={status}
      onChange={(e) => handleChange(e.target.value)}
      disabled={saving}
      className={`text-xs px-2 py-0.5 rounded border bg-transparent cursor-pointer disabled:opacity-50 ${statusColors[status] ?? ""}`}
    >
      {statuses.map((s) => (
        <option key={s} value={s} className="bg-gray-900 text-gray-100">
          {s}
        </option>
      ))}
    </select>
  );
}
