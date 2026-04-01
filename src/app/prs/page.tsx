import "@/lib/init";
import { getTrackedPRs } from "@/db/index";
import { runReconcileJob } from "@/agent/jobs/reconcile-job";

export const dynamic = "force-dynamic";

export default async function PRsPage() {
  // Reconcile before listing — ensures PR statuses are fresh
  try {
    await runReconcileJob();
  } catch (err) {
    console.error("[prs] Reconcile failed:", (err as Error).message);
  }

  const prs = await getTrackedPRs();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Tracked PRs</h2>
      {prs.length === 0 ? (
        <p className="text-gray-500">No open PRs being tracked.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="p-3">Repo</th>
                <th className="p-3">PR</th>
                <th className="p-3">Branch</th>
                <th className="p-3">Created</th>
                <th className="p-3">Last Checked</th>
              </tr>
            </thead>
            <tbody>
              {prs.map((pr) => (
                <tr key={`${pr.repo}-${pr.pr_number}`} className="border-b border-gray-800/50">
                  <td className="p-3">{pr.repo}</td>
                  <td className="p-3">
                    <a
                      href={`https://github.com/${pr.repo}/pull/${pr.pr_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      #{pr.pr_number}
                    </a>
                  </td>
                  <td className="p-3 text-gray-400">
                    <code className="text-xs">{pr.branch}</code>
                  </td>
                  <td className="p-3 text-gray-400">{new Date(pr.created_at).toLocaleDateString()}</td>
                  <td className="p-3 text-gray-400">{new Date(pr.last_checked).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
