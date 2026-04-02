import { getJob, getJobSteps } from "@/db/index";
import { LiveStream } from "@/components/jobs/live-stream";
import Link from "next/link";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  completed: "text-green-400",
  failed: "text-red-400",
  aborted: "text-gray-400",
  running: "text-blue-400",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-4">Job Not Found</h2>
        <Link href="/jobs" className="text-blue-400 hover:underline">Back to jobs</Link>
      </div>
    );
  }

  // For completed/failed jobs, load persisted logs from DB
  const isFinished = job.status !== "running";
  const steps = isFinished ? await getJobSteps(jobId) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">
            <span className="capitalize">{job.type}</span> Job
            <span className={`ml-3 text-lg ${statusColors[job.status] ?? ""}`}>
              ({job.status})
            </span>
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {job.repo && <span>{job.repo} — </span>}
            Started {new Date(job.startedAt).toLocaleString()}
            {job.finishedAt && (
              <span> — {Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s</span>
            )}
            {job.costUsd > 0 && <span> — ${job.costUsd.toFixed(4)}</span>}
          </p>
        </div>
        <Link
          href="/jobs"
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          All jobs
        </Link>
      </div>

      {job.status === "running" ? (
        <LiveStream jobId={jobId} />
      ) : steps.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800">
            <span className="text-sm font-medium capitalize">{job.status}</span>
          </div>
          <div className="p-4 max-h-[600px] overflow-y-auto font-mono text-xs space-y-0.5">
            {steps.map((step) => (
              <div key={step.id} className="text-gray-300 leading-relaxed">
                <span className="text-gray-600 mr-2">
                  {step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : ""}
                </span>
                {step.text}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <p className="text-sm text-gray-500">
            {job.error ? `Error: ${job.error}` : "No log output recorded for this job."}
          </p>
        </div>
      )}
    </div>
  );
}
