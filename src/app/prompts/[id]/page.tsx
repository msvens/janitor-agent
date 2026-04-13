"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function PromptEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();

  const [name, setName] = useState("");
  const [type, setType] = useState("plan");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew) {
      fetch(`/api/prompts/${id}`)
        .then((r) => r.json())
        .then((data) => {
          setName(data.name);
          setType(data.type);
          setContent(data.content);
          setDescription(data.description);
          setIsDefault(data.is_default);
        })
        .catch((err) => setError(err.message));
    }
  }, [id, isNew]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const url = isNew ? "/api/prompts" : `/api/prompts/${id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, content, description, is_default: isDefault }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      router.push("/prompts");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this prompt?")) return;
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Delete failed");
      }
      router.push("/prompts");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-bold">{isNew ? "New Prompt" : "Edit Prompt"}</h2>
        <div className="flex gap-2 flex-wrap">
          {!isNew && !isDefault && (
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !name || !content}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!isNew}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="plan">Plan</option>
              <option value="action">Action</option>
              <option value="fix">Fix</option>
              <option value="review">Review</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="What this prompt does..."
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Prompt Content
            <span className="text-gray-600 ml-2">
              {type === "plan" && "Placeholders: {{LEVEL}}, {{LEVEL_DESCRIPTION}}, {{EXISTING_TASKS}}"}
              {type === "action" && "Placeholders: {{TASK_TITLE}}, {{TASK_DESCRIPTION}}, {{CHANGES}}"}
              {type === "fix" && "Placeholder: {{TEST_OUTPUT}}"}
              {type === "review" && "No placeholders — comments are passed as user prompt"}
            </span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[200px] sm:min-h-[400px] md:min-h-[500px] resize-y bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
