import Link from "next/link";
import { listJobs } from "@/db/index";

const statusIcons: Record<string, { icon: string; color: string }> = {
  completed: { icon: "✓", color: "text-green-400" },
  failed: { icon: "✗", color: "text-red-400" },
  aborted: { icon: "⊘", color: "text-gray-400" },
  running: { icon: "⟳", color: "text-blue-400" },
};

const typeLabels: Record<string, string> = {
  plan: "Planning",
  action: "Action",
  reconcile: "Reconcile",
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function RecentActivity() {
  const allJobs = await listJobs(20);
  // Filter out jobs that were just killed by server restart with no real work done
  const jobs = allJobs
    .filter((j) => !(j.error === "Server restarted" && j.costUsd === 0))
    .slice(0, 10);

  if (jobs.length === 0) {
    return (
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
        <p className="text-sm text-gray-500">No jobs have been run yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
      <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
        {jobs.map((job) => {
          const { icon, color } = statusIcons[job.status] ?? statusIcons.completed!;
          const typeLabel = typeLabels[job.type] ?? job.type;

          return (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
            >
              <span className={`text-lg ${color}`}>{icon}</span>
              <span className="text-xs text-gray-500 w-16 shrink-0">
                {relativeTime(job.startedAt)}
              </span>
              <span className="text-sm text-gray-300 flex-1 min-w-0">
                <span className="font-medium">{typeLabel}</span>
                {job.repo && (
                  <span className="text-gray-500 ml-1">({job.repo})</span>
                )}
                {job.error && (
                  <span className="text-red-400 ml-2 truncate">— {job.error}</span>
                )}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                {job.costUsd > 0 && (
                  <span className="text-xs text-gray-500">${job.costUsd.toFixed(2)}</span>
                )}
                {job.finishedAt && (
                  <span className="text-xs text-gray-600">
                    {Math.round(
                      (new Date(job.finishedAt).getTime() -
                        new Date(job.startedAt).getTime()) /
                        1000,
                    )}s
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
