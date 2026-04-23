"use client";

import { useEffect, useMemo, useState } from "react";
import { LockClosedIcon } from "@heroicons/react/24/outline";

interface GithubRepo {
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  pushed_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Names of repos already added, will be hidden from the list. */
  excludeNames: Set<string>;
  onPick: (repo: { name: string; branch: string }) => void;
}

export function AddRepoDialog(props: Props) {
  // Unmount entirely when closed so each open starts with fresh state.
  if (!props.open) return null;
  return <DialogContent {...props} />;
}

function DialogContent({ onClose, excludeNames, onPick }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/github/repos")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (${r.status})`);
        }
        return r.json() as Promise<GithubRepo[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setRepos(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => !excludeNames.has(r.full_name))
      .filter(
        (r) =>
          q === "" ||
          r.full_name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      );
  }, [repos, excludeNames, query]);

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Add repo</h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your GitHub repos..."
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="p-4 text-sm text-gray-500">Loading your repos...</p>
          )}
          {error && <p className="p-4 text-sm text-red-400">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="p-4 text-sm text-gray-500">
              {repos.length === 0
                ? "No pushable repos found on your account."
                : query
                  ? "No repos match your search."
                  : "All your pushable repos are already added."}
            </p>
          )}
          <ul className="divide-y divide-gray-800">
            {filtered.map((r) => (
              <li key={r.full_name}>
                <button
                  onClick={() => {
                    onPick({ name: r.full_name, branch: r.default_branch });
                    onClose();
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-800/70 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-100 font-medium truncate">
                      {r.full_name}
                    </span>
                    {r.private && (
                      <span className="flex items-center gap-0.5 text-[10px] text-gray-500 uppercase tracking-wide">
                        <LockClosedIcon className="w-3 h-3" />
                        Private
                      </span>
                    )}
                    <span className="text-[10px] text-gray-600 ml-auto shrink-0">
                      {r.default_branch}
                    </span>
                  </div>
                  {r.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {r.description}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
