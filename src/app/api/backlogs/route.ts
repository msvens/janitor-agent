import { getAllRepos, getTasksForRepo } from "@/db/index";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const repos = await getAllRepos();
  const result = await Promise.all(
    repos.map(async (repo) => {
      const tasks = await getTasksForRepo(repo.name);
      return {
        repo: repo.name,
        aggressiveness: repo.aggressiveness,
        lastPlanned: repo.lastPlanned,
        taskCounts: {
          pending: tasks.filter((t) => t.status === "pending").length,
          in_progress: tasks.filter((t) => t.status === "in_progress").length,
          completed: tasks.filter((t) => t.status === "completed").length,
          failed: tasks.filter((t) => t.status === "failed").length,
          skipped: tasks.filter((t) => t.status === "skipped").length,
          total: tasks.length,
        },
      };
    }),
  );
  return NextResponse.json(result);
}
