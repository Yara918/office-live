"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import { useStudio } from "@/lib/store";
import { formatRelativeTime } from "@/lib/constants";
import type { SessionRecord } from "@/types/game";

export default function SessionSwitcher({
  sessions,
  activeKey,
}: {
  sessions: SessionRecord[];
  activeKey?: string;
}) {
  const { newSession, switchSession } = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel =
    sessions.find((s) => s.key === activeKey)?.label ?? activeKey?.split(":").pop() ?? "默认会话";

  return (
    <div ref={ref} className="session-switcher">
      <button
        type="button"
        className="pixel-button"
        style={{
          fontSize: 7,
          padding: "3px 8px",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 140,
        }}
        onClick={() => setOpen((prev) => !prev)}
        title="切换会话"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activeLabel}</span>
        <ChevronDown
          size={10}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      <button
        type="button"
        className="pixel-button pixel-button--primary"
        style={{ fontSize: 7, padding: "3px 6px", whiteSpace: "nowrap" }}
        onClick={() => {
          newSession();
          setOpen(false);
        }}
        title="新建会话"
      >
        <Plus size={10} />
      </button>

      {open && (
        <div className="session-dropdown">
          {sessions.length === 0 ? (
            <div className="session-dropdown__empty">暂无会话</div>
          ) : (
            sessions.map((session) => {
              const isActive = session.key === activeKey;
              return (
                <button
                  key={session.key}
                  type="button"
                  className={`session-dropdown__item ${isActive ? "session-dropdown__item--active" : ""}`}
                  onClick={() => {
                    switchSession(session.key);
                    setOpen(false);
                  }}
                >
                  <div style={{ fontWeight: isActive ? "bold" : "normal" }}>
                    {session.label ?? session.key.split(":").pop()}
                  </div>
                  <div className="session-dropdown__time">
                    {formatRelativeTime(session.createdAt)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
