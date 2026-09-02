"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type OperationLogTone = "info" | "ok" | "error" | "pending";

export type OperationLogEntry = {
  id: string;
  time: string;
  text: string;
  tone: OperationLogTone;
};

type OperationLogContextValue = {
  logs: OperationLogEntry[];
  addLog: (text: string, tone?: OperationLogTone) => string;
  updateLog: (id: string | undefined, text: string, tone?: OperationLogTone) => void;
  clearLogs: () => void;
};

const OperationLogContext = createContext<OperationLogContextValue | null>(null);
let externalAddLog: ((text: string, tone?: OperationLogTone) => string) | null = null;

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function emitOperationLog(text: string, tone: OperationLogTone = "info") {
  return externalAddLog?.(text, tone);
}

export function OperationLogProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<OperationLogEntry[]>([
    {
      id: "initial",
      time: nowText(),
      text: "Office Live 小剧场已打开，等待飞书多维表格同步。",
      tone: "info",
    },
  ]);

  const addLog = useCallback((text: string, tone: OperationLogTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setLogs((current) =>
      [
        {
          id,
          time: nowText(),
          text,
          tone,
        },
        ...current,
      ].slice(0, 80),
    );
    return id;
  }, []);

  const updateLog = useCallback(
    (id: string | undefined, text: string, tone: OperationLogTone = "info") => {
      if (!id) return;
      setLogs((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, text, tone, time: nowText() } : entry,
        ),
      );
    },
    [],
  );

  externalAddLog = addLog;

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const value = useMemo(
    () => ({ logs, addLog, updateLog, clearLogs }),
    [addLog, clearLogs, logs, updateLog],
  );

  return <OperationLogContext.Provider value={value}>{children}</OperationLogContext.Provider>;
}

export function useOperationLog() {
  const ctx = useContext(OperationLogContext);
  if (!ctx) throw new Error("useOperationLog must be used within OperationLogProvider");
  return ctx;
}
