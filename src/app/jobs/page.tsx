import { RunButton } from "@/components/jobs/run-button";
import { EventFeed } from "@/components/event-feed";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-bold">Jobs</h2>
        <div className="flex gap-2 flex-wrap">
          <RunButton type="plan" label="Plan" className="bg-purple-600 hover:bg-purple-500 text-white" />
          <RunButton type="action" label="Action" />
          <RunButton type="reconcile" label="Reconcile" className="bg-gray-700 hover:bg-gray-600 text-white" />
        </div>
      </div>

      <EventFeed filter="all" limit={50} />
    </div>
  );
}
