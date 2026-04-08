import Link from "next/link";
import { getAllRepos, getTasksForRepo, getTrackedPRs } from "@/db/index";
import { RunButton } from "@/components/jobs/run-button";
import { TodayStats } from "@/components/dashboard/today-stats";
import { EventFeed } from "@/components/event-feed";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const repos = await getAllRepos();
  const prs = await getTrackedPRs();

  const repoData = await Promise.all(
    repos.map(async (repo) => {
      const tasks = await getTasksForRepo(repo.name);
      const byStatus = {
        pending: tasks.filter((t) => t.status === "pending").length,
        in_progress: tasks.filter((t) => t.status === "in_progress").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        skipped: tasks.filter((t) => t.status === "skipped").length,
      };
      const openPrs = prs.filter((p) => p.repo === repo.name);
      return { ...repo, tasks: byStatus, total: tasks.length, openPrs };
    }),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex gap-2">
          <RunButton type="plan" label="Plan All" className="bg-purple-600 hover:bg-purple-500 text-white" />
          <RunButton type="action" label="Run Action" />
          <RunButton type="reconcile" label="Reconcile" className="bg-gray-700 hover:bg-gray-600 text-white" />
        </div>
      </div>

      <TodayStats />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {repoData.map((repo) => (
          <Link
            key={repo.name}
            href={`/backlogs/${repo.name.replace("/", "-")}`}
            className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors block"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-100">{repo.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                Level {repo.aggressiveness}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm mb-3">
              <div>
                <span className="text-yellow-400 font-medium">{repo.tasks.pending}</span>
                <span className="text-gray-500 ml-1">pending</span>
              </div>
              <div>
                <span className="text-blue-400 font-medium">{repo.tasks.in_progress}</span>
                <span className="text-gray-500 ml-1">active</span>
              </div>
              <div>
                <span className="text-green-400 font-medium">{repo.tasks.completed}</span>
                <span className="text-gray-500 ml-1">done</span>
              </div>
            </div>
            {repo.tasks.failed > 0 && (
              <div className="text-sm text-red-400 mb-2">
                {repo.tasks.failed} failed
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{repo.total} total tasks</span>
              <span>{repo.openPrs.length} open PRs</span>
            </div>
            {repo.lastPlanned && (
              <div className="text-xs text-gray-600 mt-2">
                Last planned: {new Date(repo.lastPlanned).toLocaleDateString()}
              </div>
            )}
          </Link>
        ))}
      </div>

      {repos.length === 0 && (
        <p className="text-gray-500">No repos configured. Add repos in the Config page.</p>
      )}

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
        <EventFeed filter="tasks-only" limit={10} />
      </div>
    </div>
  );
}
