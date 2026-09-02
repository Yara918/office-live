"use client";

import type { SeatState } from "@/types/game";
import HudFlyout from "./HudFlyout";

function seatStatusLabel(seat: SeatState) {
  if (!seat.assigned) return "空位";
  if (seat.status === "empty") return "待命";
  if (seat.status === "returning") return "回工位";
  if (seat.status === "running") return "处理中";
  if (seat.status === "done") return "已完成";
  if (seat.status === "failed") return "异常";
  return seat.status;
}

function SeatGroup({ title, seats }: { title: string; seats: SeatState[] }) {
  if (seats.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 7,
          color: "var(--pixel-muted)",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {seats.map((seat) => (
        <div key={seat.seatId} className="hud-workers__item">
          <div className="hud-workers__top">
            <span className={`hud-status hud-status--${seat.status}`}>{seatStatusLabel(seat)}</span>
            <span>
              {seat.assigned ? seat.label : "空工位"}
              {seat.seatType === "agent" && seat.agentConfig?.agentId && (
                <span style={{ fontSize: 7, color: "var(--pixel-accent)", marginLeft: 6 }}>
                  [{seat.agentConfig.agentId}]
                </span>
              )}
            </span>
          </div>
          <div className="hud-workers__task">
            {seat.assigned
              ? (seat.taskSnippet ??
                `${seat.roleTitle ?? "成员"}在工位待命`)
              : "给这个工位安排一位成员"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorkerPanel({
  seats,
  onOpenManager,
}: {
  seats: SeatState[];
  onOpenManager: () => void;
}) {
  const assigned = seats.filter((s) => s.assigned).length;
  const working = seats.filter(
    (s) => s.assigned && (s.status === "running" || s.status === "returning"),
  ).length;

  return (
    <HudFlyout
      title="团队成员"
      subtitle={`${working}/${assigned} 忙碌 · ${assigned} 位成员（来自飞书表格）`}
      headerAction={
        <button
          type="button"
          className="pixel-button pixel-button--primary"
          style={{ fontSize: 7, padding: "4px 8px" }}
          onClick={onOpenManager}
        >
          成员外观
        </button>
      }
    >
      <div className="hud-workers">
        <SeatGroup title={`成员 (${assigned})`} seats={seats.filter((s) => s.assigned)} />
      </div>
    </HudFlyout>
  );
}
