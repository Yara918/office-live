"use client";

import { Square } from "lucide-react";
import type { ChatMessage } from "@/types/game";
import ToolBubble from "./ToolBubble";

export default function MessageBubble({
  msg,
  actorName,
  canStop,
  onStop,
}: {
  msg: ChatMessage;
  actorName?: string;
  canStop?: boolean;
  onStop?: () => void;
}) {
  if (msg.role === "system") {
    return <div className="hud-chat__system">{msg.content}</div>;
  }

  if (msg.role === "tool") {
    return <ToolBubble msg={msg} />;
  }

  const handleStop = () => {
    if (onStop) onStop();
  };

  return (
    <div
      className={`hud-chat__bubble ${
        msg.role === "user" ? "hud-chat__bubble--user" : "hud-chat__bubble--assistant"
      }`}
    >
      <div className="hud-chat__header">
        <div className="hud-chat__role">
          {msg.role === "user" ? "You" : (msg.actorName ?? actorName ?? "Assistant")}
        </div>
        {canStop && msg.role === "user" && (
          <button
            type="button"
            className="hud-chat__stop"
            onClick={handleStop}
            title="Stop task"
            aria-label="Stop task"
          >
            <Square size={10} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="hud-chat__content">
        {msg.content}
        {msg.streaming ? <span className="pixel-cursor">▌</span> : null}
      </div>
    </div>
  );
}
