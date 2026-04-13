const statusConfig: Record<string, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "text-yellow-400 bg-yellow-400/10" },
  in_progress: { label: "In Progress", classes: "text-blue-400 bg-blue-400/10" },
  completed: { label: "Completed", classes: "text-green-400 bg-green-400/10" },
  failed: { label: "Failed", classes: "text-red-400 bg-red-400/10" },
  skipped: { label: "Dismissed", classes: "text-gray-400 bg-gray-400/10" },
};

export function TaskStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, classes: "text-gray-400 bg-gray-400/10" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${config.classes}`}>
      {config.label}
    </span>
  );
}
