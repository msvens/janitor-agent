import "@/lib/init";
import Link from "next/link";
import { getAllPrompts } from "@/db/index";

export const dynamic = "force-dynamic";

const typeColors: Record<string, string> = {
  plan: "text-purple-400 bg-purple-400/10",
  action: "text-blue-400 bg-blue-400/10",
  fix: "text-orange-400 bg-orange-400/10",
  review: "text-green-400 bg-green-400/10",
};

export default async function PromptsPage() {
  const prompts = await getAllPrompts();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Prompts</h2>
        <Link
          href="/prompts/new"
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
        >
          New Prompt
        </Link>
      </div>

      {prompts.length === 0 ? (
        <p className="text-gray-500">No prompts configured. They will be seeded on first run.</p>
      ) : (
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <Link
              key={prompt.id}
              href={`/prompts/${prompt.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{prompt.name}</h3>
                  {prompt.is_default && (
                    <span className="text-xs text-gray-500">(default)</span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${typeColors[prompt.type] ?? ""}`}>
                  {prompt.type}
                </span>
              </div>
              <p className="text-sm text-gray-400">{prompt.description}</p>
              <p className="text-xs text-gray-600 mt-2">
                {prompt.content.slice(0, 120)}...
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
