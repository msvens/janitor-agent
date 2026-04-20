import "@/lib/init";
import { getAllPRs } from "@/db/index";
import { runReconcileJob } from "@/agent/jobs/reconcile-job";
import { ReviewPRButton } from "@/components/prs/review-pr-button";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  open: "text-blue-400 bg-blue-400/10",
  merged: "text-green-400 bg-green-400/10",
  closed: "text-gray-400 bg-gray-400/10",
};

export default async function PRsPage() {
  try {
    await runReconcileJob();
  } catch (err) {
    console.error("[prs] Reconcile failed:", (err as Error).message);
  }

  const prs = await getAllPRs();

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Pull Requests</h2>
      {prs.length === 0 ? (
        <p className="text-gray-500">No PRs created yet.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="p-3">Repo</th>
                <th className="p-3">PR</th>
                <th className="p-3 hidden md:table-cell">Branch</th>
                <th className="p-3">Status</th>
                <th className="p-3 hidden sm:table-cell">Created</th>
                <th className="p-3"></th>
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
                  <td className="p-3 text-gray-400 hidden md:table-cell">
                    <code className="text-xs">{pr.branch}</code>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[pr.status] ?? ""}`}>
                      {pr.status}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 hidden sm:table-cell">{new Date(pr.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    {pr.status === "open" && (
                      <ReviewPRButton repo={pr.repo} prNumber={pr.pr_number} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
