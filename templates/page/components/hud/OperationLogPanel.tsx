"use client";

import { useOperationLog } from "@/lib/operation-log";
import HudFlyout from "./HudFlyout";

const toneColor = {
  info: "var(--pixel-muted)",
  ok: "var(--pixel-green)",
  error: "var(--pixel-red)",
  pending: "var(--pixel-yellow)",
};

export default function OperationLogPanel() {
  const { logs, clearLogs } = useOperationLog();

  return (
    <HudFlyout
      title="操作记录"
      subtitle="记录互动、任务调整和飞书同步结果"
      headerAction={
        <button
          type="button"
          className="pixel-button"
          onClick={clearLogs}
          style={{ fontSize: 8, padding: "5px 8px" }}
        >
          清空
        </button>
      }
    >
      <div className="hud-panel__stack" style={{ gap: 8, maxHeight: 360, overflow: "auto" }}>
        {logs.length === 0 ? (
          <div className="hud-empty">暂无操作记录。</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="pixel-panel"
              style={{ padding: 9, background: "rgba(255,255,255,0.04)" }}
            >
              <div style={{ fontSize: 8, color: toneColor[log.tone], marginBottom: 5 }}>
                {log.time}
              </div>
              <div style={{ fontSize: 9, lineHeight: 1.7 }}>{log.text}</div>
            </div>
          ))
        )}
      </div>
    </HudFlyout>
  );
}
