import { getJob } from "@/db/index";
import { LiveStream } from "@/components/jobs/live-stream";
import Link from "next/link";

export const dynamic = "force-dynamic";

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">
            <span className="capitalize">{job.type}</span> Job
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {job.repo && <span>{job.repo} — </span>}
            Started {new Date(job.startedAt).toLocaleString()}
          </p>
        </div>
        <Link
          href="/jobs"
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          All jobs
        </Link>
      </div>

      <LiveStream jobId={jobId} />
    </div>
  );
}
