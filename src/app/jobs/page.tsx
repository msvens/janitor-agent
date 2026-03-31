import Link from "next/link";
import { listJobs } from "@/db/index";
import { RunButton } from "@/components/jobs/run-button";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  running: "text-blue-400 bg-blue-400/10",
  completed: "text-green-400 bg-green-400/10",
  failed: "text-red-400 bg-red-400/10",
  aborted: "text-gray-400 bg-gray-400/10",
};

export default async function JobsPage() {
  const jobs = await listJobs(50);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Jobs</h2>
        <div className="flex gap-2">
          <RunButton type="plan" label="Plan" className="bg-purple-600 hover:bg-purple-500 text-white" />
          <RunButton type="action" label="Action" />
          <RunButton type="reconcile" label="Reconcile" className="bg-gray-700 hover:bg-gray-600 text-white" />
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-gray-500">No jobs have been run yet. Start one above.</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium capitalize">{job.type}</span>
                  {job.repo && <span className="text-gray-400 text-sm">{job.repo}</span>}
                </div>
                <div className="flex items-center gap-3">
                  {job.costUsd > 0 && (
                    <span className="text-xs text-gray-500">
                      ${job.costUsd.toFixed(4)}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${statusColors[job.status] ?? ""}`}
                  >
                    {job.status}
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(job.startedAt).toLocaleString()}
                {job.finishedAt && (
                  <span> — {Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s</span>
                )}
              </div>
              {job.error && (
                <div className="text-xs text-red-400 mt-1 truncate">{job.error}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
