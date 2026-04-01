import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { AutopilotBanner } from "@/components/layout/autopilot-banner";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Janitor Agent",
  description: "Autonomous code maintenance agent",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.className} bg-gray-950 text-gray-100 min-h-screen`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col">
            <AutopilotBanner />
            <main className="flex-1 p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
