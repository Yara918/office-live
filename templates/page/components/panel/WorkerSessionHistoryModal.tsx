"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import type { ChatMessage } from "@/types/game";
import { formatRelativeTime, isVisibleChatMessage } from "@/lib/constants";
import MessageBubble from "@/components/hud/MessageBubble";

interface SessionWithRecord {
  key: string;
  label: string;
  createdAt: string;
}

function useSessionsForSeat(seatId: string | undefined) {
  const { state, getBoundSessionForSeat } = useStudio();
  return useMemo(() => {
    if (!seatId) return [];
    const keys = new Set<string>();
    for (const t of state.tasks) {
      if (t.seatId === seatId) keys.add(t.sessionKey);
    }
    const bound = getBoundSessionForSeat(seatId);
    if (bound) keys.add(bound);

    return [...keys]
      .map((key) => {
        const rec = state.sessions.find((s) => s.key === key);
        return {
          key,
          label: rec?.label ?? `Session ${key.slice(-8)}`,
          createdAt: rec?.createdAt ?? "",
        } satisfies SessionWithRecord;
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [seatId, state.tasks, state.sessions, getBoundSessionForSeat]);
}

export default function WorkerSessionHistoryModal() {
  const { state, loadSessionChat } = useStudio();
  const [open, setOpen] = useState(false);
  const [seatId, setSeatId] = useState<string | undefined>(undefined);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [loadedChats, setLoadedChats] = useState<Map<string, ChatMessage[]>>(new Map());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessionsForSeat = useSessionsForSeat(seatId);
  const seatLabel = seatId ? (state.seats.find((s) => s.seatId === seatId)?.label ?? seatId) : "";

  useEffect(() => {
    return gameEvents.on("open-session-history", (sid) => {
      setSeatId(sid);
      setSelectedKey(undefined);
      setLoadedChats(new Map());
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (open && sessionsForSeat.length > 0 && !selectedKey) {
      setSelectedKey(sessionsForSeat[0].key);
    }
  }, [open, sessionsForSeat, selectedKey]);

  const messages = useMemo(() => {
    if (!selectedKey) return [];
    const fromState = state.chatMessages.filter(
      (m) => m.sessionKey === selectedKey && isVisibleChatMessage(m),
    );
    const fromLoaded = loadedChats.get(selectedKey);
    if (fromLoaded && fromLoaded.length > 0) return fromLoaded;
    return fromState;
  }, [selectedKey, state.chatMessages, loadedChats]);

  const loadChat = useCallback(
    async (sessionKey: string) => {
      if (loadedChats.has(sessionKey)) return;
      setLoadingKey(sessionKey);
      try {
        const msgs = await loadSessionChat(sessionKey);
        setLoadedChats((prev) => new Map(prev).set(sessionKey, msgs));
      } finally {
        setLoadingKey(null);
      }
    },
    [loadSessionChat, loadedChats],
  );

  useEffect(() => {
    if (selectedKey && messages.length === 0 && !loadingKey) {
      void loadChat(selectedKey);
    }
  }, [selectedKey, messages.length, loadingKey, loadChat]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const visibleTasks = useMemo(
    () => (selectedKey ? state.tasks.filter((t) => t.sessionKey === selectedKey) : []),
    [selectedKey, state.tasks],
  );
  const actorByRunId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of visibleTasks) {
      if (!task.actorName) continue;
      if (task.runId) map.set(task.runId, task.actorName);
      map.set(task.taskId, task.actorName);
    }
    return map;
  }, [visibleTasks]);

  const close = useCallback(() => {
    setOpen(false);
    setSeatId(undefined);
    setSelectedKey(undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: "rgba(0,0,0,0.6)", pointerEvents: "auto" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="pixel-panel"
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "80vh",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div style={{ fontSize: "10px" }}>
            {">"} Session History — {seatLabel}
          </div>
          <button
            className="pixel-button"
            style={{ fontSize: "8px", padding: "2px 8px" }}
            onClick={close}
          >
            ESC
          </button>
        </div>

        <div style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0 }}>
          {/* Sessions list */}
          <div
            style={{
              width: "140px",
              flexShrink: 0,
              border: "2px solid var(--pixel-border)",
              borderRadius: "var(--pixel-radius-sm)",
              background: "var(--pixel-bg)",
              overflowY: "auto",
              maxHeight: "320px",
            }}
          >
            {sessionsForSeat.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "9px", color: "var(--pixel-muted)" }}>
                暂无会话
              </div>
            ) : (
              sessionsForSeat.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="pixel-button"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    fontSize: "9px",
                    border: "none",
                    borderBottom: "1px solid var(--pixel-border)",
                    background: selectedKey === s.key ? "var(--pixel-border)" : "transparent",
                  }}
                  onClick={() => setSelectedKey(s.key)}
                >
                  <div style={{ fontWeight: selectedKey === s.key ? "bold" : "normal" }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: "8px", color: "var(--pixel-muted)", marginTop: 2 }}>
                    {formatRelativeTime(s.createdAt)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Chat history */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              border: "2px solid var(--pixel-border)",
              borderRadius: "var(--pixel-radius-sm)",
              background: "var(--pixel-bg)",
              padding: "10px",
              maxHeight: "320px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {loadingKey === selectedKey ? (
              <div style={{ fontSize: "9px", color: "var(--pixel-muted)" }}>加载中...</div>
            ) : messages.length === 0 ? (
              <div style={{ fontSize: "9px", color: "var(--pixel-muted)" }}>
                这个会话暂无消息
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  actorName={actorByRunId.get(msg.runId)}
                  canStop={false}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
