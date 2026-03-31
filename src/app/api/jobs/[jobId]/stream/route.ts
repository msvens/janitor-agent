import { jobManager, type JobLogEvent } from "@/lib/job-manager";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Replay existing logs
      const existingLogs = jobManager.getLogs(jobId);
      for (const msg of existingLogs) {
        const event: JobLogEvent = { jobId, message: msg, timestamp: "" };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // If no job running with this ID, close immediately
      if (jobManager.getRunningJobId() !== jobId) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
        return;
      }

      // Subscribe to live events
      const onEvent = (event: JobLogEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const onDone = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
        cleanup();
      };

      const cleanup = () => {
        jobManager.off(`job:${jobId}`, onEvent);
        jobManager.off(`job:${jobId}:done`, onDone);
      };

      jobManager.on(`job:${jobId}`, onEvent);
      jobManager.on(`job:${jobId}:done`, onDone);

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
