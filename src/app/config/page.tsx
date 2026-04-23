"use client";

import { useEffect, useState } from "react";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { AddRepoDialog } from "@/components/add-repo-dialog";

interface RepoConfig {
  name: string;
  aggressiveness: number;
  branch: string;
  install_command?: string;
  test_command?: string;
  plan_prompt_id?: string;
  action_prompt_id?: string;
  added_by_login?: string | null;
}

interface Prompt {
  id: string;
  name: string;
  type: string;
}

type Backend = "claude" | "ollama" | "gemini";

interface Settings {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  claude_model: string;
  ollama_model: string;
  gemini_model: string;
  ollama_enabled: boolean;
  ollama_num_ctx: number;
  ollama_max_aggressiveness: number;
  ollama_max_steps: number;
  claude_max_steps: number;
  gemini_max_steps: number;
  planning_max_steps: number;
  planner_backend: Backend;
  action_backend: Backend;
  fix_backend: Backend;
  review_backend: Backend;
  autopilot_enabled: boolean;
  autopilot_interval_minutes: number;
}

interface BootstrapConfig {
  database_url: string;
  port: number;
  workspace_dir: string;
  ollama: { host: string };
}

interface EnvStatus {
  anthropicKeyPresent: boolean;
  geminiKeyPresent: boolean;
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

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
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
        setEnv(data.env ?? null);
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

  function addRepoFromPick(picked: { name: string; branch: string }) {
    const defaultPlan = prompts.find((p) => p.type === "plan");
    const defaultAction = prompts.find((p) => p.type === "action");
    setRepos([...repos, {
      name: picked.name,
      aggressiveness: 2,
      branch: picked.branch,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-bold">Configuration</h2>
        <div className="flex items-center gap-3 flex-wrap">
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
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-3 sm:p-5">
          <h3 className="font-semibold mb-1">Bootstrap</h3>
          <p className="text-xs text-gray-500 mb-4">From config.yaml — restart required to change</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Database URL" value={config.database_url} onChange={() => {}} disabled />
            <Input label="Port" value={config.port} onChange={() => {}} disabled />
            <Input label="Ollama host" value={config.ollama.host} onChange={() => {}} disabled />
            <Input label="Workspace directory" value={config.workspace_dir} onChange={() => {}} disabled />
          </div>
          {env && (
            <div className="mt-4 flex flex-col gap-1 text-xs">
              <span className={env.anthropicKeyPresent ? "text-green-400" : "text-red-400"}>
                ANTHROPIC_API_KEY: {env.anthropicKeyPresent ? "set" : "NOT SET"}
              </span>
              <span className={env.geminiKeyPresent ? "text-green-400" : "text-red-400"}>
                GEMINI_API_KEY: {env.geminiKeyPresent ? "set" : "NOT SET — create a key at https://aistudio.google.com/apikey"}
              </span>
            </div>
          )}
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-3 sm:p-5">
          <h3 className="font-semibold mb-4">Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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

          <h4 className="text-sm font-medium text-gray-300 mb-3">Models</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <Input
              label="Claude model"
              value={settings.claude_model}
              onChange={(v) => setSettings({ ...settings, claude_model: v })}
            />
            <Input
              label="Gemini model"
              value={settings.gemini_model}
              onChange={(v) => setSettings({ ...settings, gemini_model: v })}
            />
            <Input
              label="Ollama model"
              value={settings.ollama_model}
              onChange={(v) => setSettings({ ...settings, ollama_model: v })}
            />
          </div>

          <h4 className="text-sm font-medium text-gray-300 mb-3">Agent roles</h4>
          {(() => {
            const backendOptions: { value: string; label: string }[] = [];
            if (env?.anthropicKeyPresent) backendOptions.push({ value: "claude", label: "Claude" });
            if (env?.geminiKeyPresent) backendOptions.push({ value: "gemini", label: "Gemini" });
            if (settings.ollama_enabled) backendOptions.push({ value: "ollama", label: "Ollama" });
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                  <Select
                    label="Planner"
                    value={settings.planner_backend}
                    onChange={(v) => setSettings({ ...settings, planner_backend: v as Backend })}
                    options={backendOptions}
                  />
                  <Select
                    label="Action (fallback above Ollama tier)"
                    value={settings.action_backend}
                    onChange={(v) => setSettings({ ...settings, action_backend: v as Backend })}
                    options={backendOptions}
                  />
                  <Select
                    label="Fix"
                    value={settings.fix_backend}
                    onChange={(v) => setSettings({ ...settings, fix_backend: v as Backend })}
                    options={backendOptions}
                  />
                  <Select
                    label="Review"
                    value={settings.review_backend}
                    onChange={(v) => setSettings({ ...settings, review_backend: v as Backend })}
                    options={backendOptions}
                  />
                </div>
                {settings.planner_backend === "ollama" && (
                  <p className="text-xs text-yellow-400 mb-4">
                    Ollama is not recommended for planning — tool-call reliability drops on long loops.
                  </p>
                )}
              </>
            );
          })()}

          <h4 className="text-sm font-medium text-gray-300 mb-3 mt-5">Claude</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
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

          <h4 className="text-sm font-medium text-gray-300 mb-3">Gemini</h4>
          <p className="text-xs text-gray-500 mb-3">
            Gemini is available in the Agent roles dropdown when GEMINI_API_KEY is set.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <Input
              label="Max steps"
              type="number"
              value={settings.gemini_max_steps}
              onChange={(v) => setSettings({ ...settings, gemini_max_steps: parseInt(v) || 15 })}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
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

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-3 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Repos</h3>
            <button
              onClick={() => setAddRepoOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
            >
              <PlusIcon className="w-4 h-4" />
              Add repo
            </button>
          </div>
          <div className="space-y-4">
            {repos.map((repo, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-4">
                <div className="text-xs mb-3 flex items-center gap-1.5">
                  {repo.added_by_login ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://github.com/${repo.added_by_login}.png?size=32`}
                        alt=""
                        className="w-4 h-4 rounded-full"
                      />
                      <span className="text-gray-500">
                        Owner: <span className="text-gray-300">@{repo.added_by_login}</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-yellow-600">No owner — uses GH_TOKEN fallback</span>
                  )}
                </div>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Input label="Name (owner/repo)" value={repo.name} onChange={(v) => updateRepo(i, "name", v)} />
                    <Input label="Branch" value={repo.branch} onChange={(v) => updateRepo(i, "branch", v)} />
                    <Input label="Aggressiveness" type="number" value={repo.aggressiveness} onChange={(v) => updateRepo(i, "aggressiveness", parseInt(v) || 2)} />
                  </div>
                  <button onClick={() => removeRepo(i)} className="ml-3 mt-5 p-1.5 text-gray-500 hover:text-red-400 rounded">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Install command" value={repo.install_command ?? ""} onChange={(v) => updateRepo(i, "install_command", v || undefined as unknown as string)} />
                  <Input label="Test command" value={repo.test_command ?? ""} onChange={(v) => updateRepo(i, "test_command", v || undefined as unknown as string)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
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
      <AddRepoDialog
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        excludeNames={new Set(repos.map((r) => r.name))}
        onPick={addRepoFromPick}
      />
    </div>
  );
}
