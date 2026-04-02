import { getJobStats } from "@/db/index";
import {
  CheckCircleIcon,
  XCircleIcon,
  CurrencyDollarIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";

export async function TodayStats() {
  const { today } = await getJobStats();

  if (today.totalJobs === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-6 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg mb-6">
      <span className="text-xs text-gray-500 uppercase tracking-wide">Today</span>
      <div className="flex items-center gap-1.5 text-sm">
        <BoltIcon className="w-4 h-4 text-gray-400" />
        <span className="text-gray-300">{today.totalJobs} jobs</span>
      </div>
      {today.completed > 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <CheckCircleIcon className="w-4 h-4 text-green-400" />
          <span className="text-green-400">{today.completed} completed</span>
        </div>
      )}
      {today.failed > 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <XCircleIcon className="w-4 h-4 text-red-400" />
          <span className="text-red-400">{today.failed} failed</span>
        </div>
      )}
      {today.totalCost > 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <CurrencyDollarIcon className="w-4 h-4 text-gray-400" />
          <span className="text-gray-300">${today.totalCost.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
