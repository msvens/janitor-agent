"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRightStartOnRectangleIcon } from "@heroicons/react/24/outline";
import { NAV_ITEMS } from "./sidebar";
import { SignoutDialog } from "@/components/signout-dialog";

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const user = session?.user;
  const [signoutOpen, setSignoutOpen] = useState(false);

  function handleLogoutClick() {
    onClose();
    setSignoutOpen(true);
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-56 z-50 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform duration-200 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-semibold text-gray-100">Janitor Agent</h1>
        </div>
        <nav className="p-2 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
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
        <div className="mx-2 border-t border-gray-800" />
        <div className="p-2 space-y-1">
          {user?.githubLogin && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300">
              {user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="w-5 h-5 rounded-full" />
              )}
              <span className="truncate">@{user.githubLogin}</span>
            </div>
          )}
          <button
            onClick={handleLogoutClick}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors w-full"
          >
            <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </aside>
      <SignoutDialog open={signoutOpen} onClose={() => setSignoutOpen(false)} />
    </>
  );
}
