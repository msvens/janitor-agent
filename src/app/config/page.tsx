"use client";

import { useEffect, useState } from "react";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";

interface RepoConfig {
  name: string;
  aggressiveness: number;
  branch: string;
  install_command?: string;
  test_command?: string;
  plan_prompt_id?: string;
  action_prompt_id?: string;
}

interface Prompt {
  id: string;
  name: string;
  type: string;
}

interface Settings {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  ollama_enabled: boolean;
  ollama_num_ctx: number;
  ollama_max_aggressiveness: number;
  ollama_max_steps: number;
  claude_max_steps: number;
  planning_max_steps: number;
  autopilot_enabled: boolean;
  autopilot_interval_minutes: number;
}

interface BootstrapConfig {
  database_url: string;
  port: number;
  workspace_dir: string;
  claude: { model: string };
  ollama: { host: string; model: string };
}

function Input({ label, value, onChange, type = "text", disabled = false }: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
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
  const [config, setConfig] = useState<BootstrapConfig | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prompts").then((r) => r.json()).then(setPrompts).catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config);
        setSettings(data.settings);
        setRepos(data.repos);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, repos }),
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
    const updated = [...repos];
    updated[index] = { ...updated[index]!, [field]: value };
    setRepos(updated);
  }

  function addRepo() {
    const defaultPlan = prompts.find((p) => p.type === "plan");
    const defaultAction = prompts.find((p) => p.type === "action");
    setRepos([...repos, {
      name: "owner/repo",
      aggressiveness: 2,
      branch: "main",
      plan_prompt_id: defaultPlan?.id,
      action_prompt_id: defaultAction?.id,
    }]);
  }

  function removeRepo(index: number) {
    setRepos(repos.filter((_, i) => i !== index));
  }

  if (!config || !settings) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Configuration</h2>
        {error ? <p className="text-red-400">{error}</p> : <p className="text-gray-500">Loading...</p>}
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
          <h3 className="font-semibold mb-1">Bootstrap</h3>
          <p className="text-xs text-gray-500 mb-4">From config.yaml — restart required to change</p>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Database URL" value={config.database_url} onChange={() => {}} disabled />
            <Input label="Port" value={config.port} onChange={() => {}} disabled />
            <Input label="Claude model" value={config.claude.model} onChange={() => {}} disabled />
            <Input label="Ollama model" value={config.ollama.model} onChange={() => {}} disabled />
            <Input label="Workspace directory" value={config.workspace_dir} onChange={() => {}} disabled />
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="font-semibold mb-4">Settings</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Input
              label="Max cost per run ($)"
              type="number"
              value={settings.max_cost_per_run}
              onChange={(v) => setSettings({ ...settings, max_cost_per_run: parseFloat(v) || 0 })}
            />
            <Input
              label="Max open PRs"
              type="number"
              value={settings.max_open_prs}
              onChange={(v) => setSettings({ ...settings, max_open_prs: parseInt(v) || 0 })}
            />
            <Input
              label="Default aggressiveness"
              type="number"
              value={settings.default_aggressiveness}
              onChange={(v) => setSettings({ ...settings, default_aggressiveness: parseInt(v) || 2 })}
            />
          </div>

          <h4 className="text-sm font-medium text-gray-300 mb-3">Auto-pilot</h4>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Input
              label="Cycle interval (minutes)"
              type="number"
              value={settings.autopilot_interval_minutes}
              onChange={(v) => setSettings({ ...settings, autopilot_interval_minutes: parseInt(v) || 10 })}
            />
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Auto-pilot runs: reconcile → action, repeating every N minutes. Start/stop from the banner above. Max 1 open PR per repo.
          </p>

          <h4 className="text-sm font-medium text-gray-300 mb-3">Claude</h4>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Input
              label="Max steps"
              type="number"
              value={settings.claude_max_steps}
              onChange={(v) => setSettings({ ...settings, claude_max_steps: parseInt(v) || 15 })}
            />
            <Input
              label="Planning max steps"
              type="number"
              value={settings.planning_max_steps}
              onChange={(v) => setSettings({ ...settings, planning_max_steps: parseInt(v) || 25 })}
            />
          </div>

          <h4 className="text-sm font-medium text-gray-300 mb-3">Ollama</h4>
          <div className="mb-4">
            <Toggle
              label="Enable Ollama for simple tasks"
              checked={settings.ollama_enabled}
              onChange={(v) => setSettings({ ...settings, ollama_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Context window"
              type="number"
              value={settings.ollama_num_ctx}
              onChange={(v) => setSettings({ ...settings, ollama_num_ctx: parseInt(v) || 32768 })}
            />
            <Input
              label="Max aggressiveness"
              type="number"
              value={settings.ollama_max_aggressiveness}
              onChange={(v) => setSettings({ ...settings, ollama_max_aggressiveness: parseInt(v) || 2 })}
            />
            <Input
              label="Max steps"
              type="number"
              value={settings.ollama_max_steps}
              onChange={(v) => setSettings({ ...settings, ollama_max_steps: parseInt(v) || 15 })}
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
            {repos.map((repo, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <Input label="Name (owner/repo)" value={repo.name} onChange={(v) => updateRepo(i, "name", v)} />
                    <Input label="Branch" value={repo.branch} onChange={(v) => updateRepo(i, "branch", v)} />
                    <Input label="Aggressiveness" type="number" value={repo.aggressiveness} onChange={(v) => updateRepo(i, "aggressiveness", parseInt(v) || 2)} />
                  </div>
                  <button onClick={() => removeRepo(i)} className="ml-3 mt-5 p-1.5 text-gray-500 hover:text-red-400 rounded">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Install command" value={repo.install_command ?? ""} onChange={(v) => updateRepo(i, "install_command", v || undefined as unknown as string)} />
                  <Input label="Test command" value={repo.test_command ?? ""} onChange={(v) => updateRepo(i, "test_command", v || undefined as unknown as string)} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Plan prompt</label>
                    <select
                      value={repo.plan_prompt_id ?? ""}
                      onChange={(e) => updateRepo(i, "plan_prompt_id", e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100"
                    >
                      {prompts.filter((p) => p.type === "plan").map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Action prompt</label>
                    <select
                      value={repo.action_prompt_id ?? ""}
                      onChange={(e) => updateRepo(i, "action_prompt_id", e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100"
                    >
                      {prompts.filter((p) => p.type === "action").map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
