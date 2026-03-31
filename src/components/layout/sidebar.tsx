"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  QueueListIcon,
  CodeBracketIcon,
  CogIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";

const nav = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/backlogs", label: "Backlogs", icon: QueueListIcon },
  { href: "/prs", label: "PRs", icon: CodeBracketIcon },
  { href: "/jobs", label: "Jobs", icon: PlayIcon },
  { href: "/config", label: "Config", icon: CogIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-gray-100">Janitor Agent</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
