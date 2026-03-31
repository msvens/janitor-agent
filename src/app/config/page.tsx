"use client";

import { useEffect, useState } from "react";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";

interface RepoConfig {
  name: string;
  aggressiveness: number;
  branch: string;
  install_command?: string;
  test_command?: string;
}

interface Config {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  claude: { model: string; max_steps: number };
  ollama: {
    enabled: boolean;
    host: string;
    model: string;
    num_ctx: number;
    max_steps: number;
    max_aggressiveness: number;
  };
  planning: { max_steps: number; workspace_dir: string; backlog_dir: string };
  repos: RepoConfig[];
}

function Input({ label, value, onChange, type = "text" }: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch((err) => setError(err.message));
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updateRepo(index: number, field: string, value: string | number) {
    if (!config) return;
    const repos = [...config.repos];
    repos[index] = { ...repos[index]!, [field]: value };
    setConfig({ ...config, repos });
  }

  function addRepo() {
    if (!config) return;
    setConfig({
      ...config,
      repos: [
        ...config.repos,
        { name: "owner/repo", aggressiveness: 2, branch: "main" },
      ],
    });
  }

  function removeRepo(index: number) {
    if (!config) return;
    setConfig({ ...config, repos: config.repos.filter((_, i) => i !== index) });
  }

  if (!config) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Configuration</h2>
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <p className="text-gray-500">Loading...</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Configuration</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-400">Saved</span>}
          {error && <span className="text-sm text-red-400">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="font-semibold mb-4">Global</h3>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Max cost per run ($)"
              type="number"
              value={config.max_cost_per_run}
              onChange={(v) => setConfig({ ...config, max_cost_per_run: parseFloat(v) || 0 })}
            />
            <Input
              label="Max open PRs"
              type="number"
              value={config.max_open_prs}
              onChange={(v) => setConfig({ ...config, max_open_prs: parseInt(v) || 0 })}
            />
            <Input
              label="Default aggressiveness"
              type="number"
              value={config.default_aggressiveness}
              onChange={(v) => setConfig({ ...config, default_aggressiveness: parseInt(v) || 2 })}
            />
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="font-semibold mb-4">Claude</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Model"
              value={config.claude.model}
              onChange={(v) => setConfig({ ...config, claude: { ...config.claude, model: v } })}
            />
            <Input
              label="Max steps"
              type="number"
              value={config.claude.max_steps}
              onChange={(v) => setConfig({ ...config, claude: { ...config.claude, max_steps: parseInt(v) || 15 } })}
            />
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="font-semibold mb-4">Ollama</h3>
          <div className="mb-4">
            <Toggle
              label="Enable Ollama for simple tasks"
              checked={config.ollama.enabled}
              onChange={(v) => setConfig({ ...config, ollama: { ...config.ollama, enabled: v } })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Host"
              value={config.ollama.host}
              onChange={(v) => setConfig({ ...config, ollama: { ...config.ollama, host: v } })}
            />
            <Input
              label="Model"
              value={config.ollama.model}
              onChange={(v) => setConfig({ ...config, ollama: { ...config.ollama, model: v } })}
            />
            <Input
              label="Context window"
              type="number"
              value={config.ollama.num_ctx}
              onChange={(v) => setConfig({ ...config, ollama: { ...config.ollama, num_ctx: parseInt(v) || 32768 } })}
            />
            <Input
              label="Max aggressiveness for Ollama"
              type="number"
              value={config.ollama.max_aggressiveness}
              onChange={(v) => setConfig({ ...config, ollama: { ...config.ollama, max_aggressiveness: parseInt(v) || 2 } })}
            />
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Repos</h3>
            <button
              onClick={addRepo}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
            >
              <PlusIcon className="w-4 h-4" />
              Add repo
            </button>
          </div>
          <div className="space-y-4">
            {config.repos.map((repo, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <Input
                      label="Name (owner/repo)"
                      value={repo.name}
                      onChange={(v) => updateRepo(i, "name", v)}
                    />
                    <Input
                      label="Branch"
                      value={repo.branch}
                      onChange={(v) => updateRepo(i, "branch", v)}
                    />
                    <Input
                      label="Aggressiveness"
                      type="number"
                      value={repo.aggressiveness}
                      onChange={(v) => updateRepo(i, "aggressiveness", parseInt(v) || 2)}
                    />
                  </div>
                  <button
                    onClick={() => removeRepo(i)}
                    className="ml-3 mt-5 p-1.5 text-gray-500 hover:text-red-400 rounded"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Install command"
                    value={repo.install_command ?? ""}
                    onChange={(v) => updateRepo(i, "install_command", v || undefined as unknown as string)}
                  />
                  <Input
                    label="Test command"
                    value={repo.test_command ?? ""}
                    onChange={(v) => updateRepo(i, "test_command", v || undefined as unknown as string)}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
