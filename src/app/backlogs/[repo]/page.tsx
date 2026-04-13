import Link from "next/link";
import { getTasksForRepo } from "@/db/index";
import { TaskStatusSelect } from "@/components/backlogs/task-status-select";
import { RunTaskButton } from "@/components/backlogs/run-task-button";
import { RunButton } from "@/components/jobs/run-button";

export const dynamic = "force-dynamic";

export default async function RepoBacklogPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  const repoName = decodeURIComponent(repo).replace("-", "/");
  const tasks = await getTasksForRepo(repoName);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">{repoName}</h2>
          <p className="text-gray-500">{tasks.length} tasks</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RunButton type="plan" repo={repoName} label="Plan" className="bg-purple-600 hover:bg-purple-500 text-white" />
          <RunButton type="action" repo={repoName} label="Run Action" />
        </div>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
              <h3 className="font-medium">{task.title}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {task.status === "pending" && (
                  <RunTaskButton taskId={task.id} repo={task.repo} />
                )}
                {task.job_id && (
                  <Link
                    href={`/jobs/${task.job_id}`}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    View log
                  </Link>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                  Level {task.aggressiveness}
                </span>
                <TaskStatusSelect
                  taskId={task.id}
                  repo={task.repo}
                  currentStatus={task.status}
                />
              </div>
            </div>
            <p className="text-sm text-gray-400 mb-3">{task.description}</p>
            {task.changes.length > 0 && (
              <details className="text-sm">
                <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
                  {task.changes.length} file changes
                </summary>
                <ul className="mt-2 space-y-1 ml-4">
                  {task.changes.map((c, i) => (
                    <li key={i} className="text-gray-400">
                      <code className="text-gray-300 text-xs">{c.file}</code>
                      <span className="text-gray-600 mx-1">:</span>
                      <span className="text-gray-500 text-xs">{c.lines}</span>
                      <span className="text-gray-600 mx-1">—</span>
                      {c.what}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {task.pr_number && (
              <a
                href={`https://github.com/${task.repo}/pull/${task.pr_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline mt-2 inline-block"
              >
                PR #{task.pr_number}
              </a>
            )}
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <p className="text-gray-500">No tasks. Click &ldquo;Plan&rdquo; to generate tasks for this repo.</p>
      )}
    </div>
  );
}
