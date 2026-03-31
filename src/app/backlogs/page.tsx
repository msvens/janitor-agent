import Link from "next/link";
import { getAllRepos, getTasksForRepo } from "@/db/index";

export const dynamic = "force-dynamic";

export default async function BacklogsPage() {
  const repos = await getAllRepos();

  const repoData = await Promise.all(
    repos.map(async (repo) => {
      const tasks = await getTasksForRepo(repo.name);
      return {
        name: repo.name,
        pending: tasks.filter((t) => t.status === "pending").length,
        total: tasks.length,
        lastPlanned: repo.lastPlanned,
      };
    }),
  );

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Backlogs</h2>
      <div className="space-y-2">
        {repoData.map((repo) => (
          <Link
            key={repo.name}
            href={`/backlogs/${repo.name.replace("/", "-")}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{repo.name}</span>
              <div className="text-sm text-gray-400">
                <span className="text-yellow-400">{repo.pending}</span> pending / {repo.total} total
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
