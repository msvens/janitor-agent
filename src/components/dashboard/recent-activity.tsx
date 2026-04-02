import Link from "next/link";
import { getRecentTasks } from "@/db/index";

const statusIcons: Record<string, { icon: string; color: string }> = {
  completed: { icon: "✓", color: "text-green-400" },
  in_progress: { icon: "⟳", color: "text-blue-400" },
  failed: { icon: "✗", color: "text-red-400" },
  skipped: { icon: "⊘", color: "text-yellow-400" },
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

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "Completed";
    case "in_progress": return "In progress";
    case "failed": return "Failed";
    case "skipped": return "Skipped";
    default: return status;
  }
}

export async function RecentActivity() {
  const tasks = await getRecentTasks(10);

  if (tasks.length === 0) {
    return (
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
        <p className="text-sm text-gray-500">No tasks have been executed yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
      <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
        {tasks.map((task) => {
          const { icon, color } = statusIcons[task.status] ?? statusIcons.completed!;
          const repoParam = task.repo.replace("/", "-");

          return (
            <Link
              key={task.id}
              href={`/backlogs/${repoParam}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
            >
              <span className={`text-lg ${color}`}>{icon}</span>
              <span className="text-xs text-gray-500 w-16 shrink-0">
                {relativeTime(task.created_at)}
              </span>
              <span className="text-sm text-gray-300 flex-1 min-w-0 truncate">
                <span className="font-medium">{task.title}</span>
                <span className="text-gray-500 ml-1">({task.repo})</span>
              </span>
              <div className="flex items-center gap-3 shrink-0">
                {task.pr_number && (
                  <span className="text-xs text-blue-400">PR #{task.pr_number}</span>
                )}
                <span className={`text-xs ${color}`}>
                  {statusLabel(task.status)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
