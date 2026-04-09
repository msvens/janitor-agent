"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface AppStatus {
  autopilotActive: boolean;
  jobRunning: boolean;
}

const StatusContext = createContext<AppStatus>({
  autopilotActive: false,
  jobRunning: false,
});

export function useAppStatus() {
  return useContext(StatusContext);
}

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>({
    autopilotActive: false,
    jobRunning: false,
  });

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch("/api/autopilot");
        const data = await res.json();
        if (mounted) {
          setStatus({
            autopilotActive: data.active,
            jobRunning: data.jobRunning,
          });
        }
      } catch {
        // ignore
      }
    };

    check();
    const interval = setInterval(check, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <StatusContext.Provider value={status}>
      {children}
    </StatusContext.Provider>
  );
}
