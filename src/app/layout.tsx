import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { StatusProvider } from "@/components/status-provider";
import { Providers } from "@/components/providers";

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
        <Providers>
          <StatusProvider>
            <div className="flex min-h-screen overflow-x-hidden">
              <Sidebar />
              <div className="flex-1 min-w-0 flex flex-col">
                <MobileHeader />
                <main className="flex-1 p-4 md:p-8">{children}</main>
              </div>
            </div>
          </StatusProvider>
        </Providers>
      </body>
    </html>
  );
}
