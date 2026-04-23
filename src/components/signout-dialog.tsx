"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

interface Summary {
  repos: number;
  tasks: number;
  jobs: number;
  prs: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SignoutDialog({ open, onClose }: Props) {
  const [deleteData, setDeleteData] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDeleteData(false);
    setError(null);
    setSummary(null);
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [open]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      if (deleteData) {
        const res = await fetch("/api/account", { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Delete failed (${res.status})`);
        }
      }
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!open) return null;

  const ownsSomething = summary !== null && summary.repos > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-100 mb-4">Sign out?</h2>

        {ownsSomething && (
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-800 hover:border-gray-700 cursor-pointer mb-4 select-none">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-red-500"
            />
            <div className="min-w-0">
              <div className="text-sm text-gray-200">
                Also delete my data and revoke GitHub access
              </div>
              <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                Removes from janitor&apos;s database:{" "}
                <span className="text-gray-400">
                  {summary!.repos} repo(s), {summary!.tasks} task(s),{" "}
                  {summary!.prs} tracked PR(s), {summary!.jobs} job record(s)
                </span>
                , plus your stored access token. Also revokes janitor from your
                GitHub Authorized OAuth Apps, so next sign-in asks for consent
                again.
                <br />
                <span className="text-gray-600">
                  Does not close or touch any actual PRs on GitHub — those stay
                  open for you to handle.
                </span>
              </div>
            </div>
          </label>
        )}

        {!ownsSomething && summary !== null && (
          <p className="text-sm text-gray-400 mb-4">
            You have no repos attributed to your account — nothing janitor-side
            to delete.
          </p>
        )}

        {summary === null && (
          <p className="text-sm text-gray-500 mb-4">Loading your data...</p>
        )}

        {error && (
          <p className="text-sm text-red-400 mb-4">{error}</p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || summary === null}
            className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
              deleteData
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-gray-800 hover:bg-gray-700 text-gray-100"
            }`}
          >
            {busy
              ? deleteData
                ? "Deleting..."
                : "Signing out..."
              : deleteData
                ? "Delete & Sign out"
                : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
