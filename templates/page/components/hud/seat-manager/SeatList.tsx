"use client";

import type { SeatState, SeatType } from "@/types/game";
import CharacterPortrait from "../CharacterPortrait";

function seatStateLabel(seat: SeatState) {
  if (!seat.assigned) return "空位";
  if (seat.status === "empty") return "待命";
  if (seat.status === "returning") return "回工位";
  if (seat.status === "running") return "处理中";
  if (seat.status === "done") return "已完成";
  if (seat.status === "failed") return "异常";
  return seat.status;
}

function seatSummary(seat: SeatState) {
  if (!seat.assigned) return "还没有安排成员";
  if (seat.status === "returning") return seat.taskSnippet ?? "正在回工位";
  if (seat.status === "running") return seat.taskSnippet ?? "正在处理任务";
  if (seat.status === "done") return "刚完成一个任务";
  if (seat.status === "failed") return "上个任务异常";
  return "在工位待命";
}

function seatTypeIcon(type: SeatType) {
  return type === "agent" ? "◆" : "●";
}

interface SeatListProps {
  seats: SeatState[];
  selectedSeatId: string;
  onSelectSeat: (seat: SeatState) => void;
}

export default function SeatList({ seats, selectedSeatId, onSelectSeat }: SeatListProps) {
  return (
    <div
      style={{
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingRight: 4,
      }}
    >
      {seats.map((seat, index) => {
        const active = seat.seatId === selectedSeatId;
        const statusLabel = seatStateLabel(seat);
        return (
          <button
            key={seat.seatId}
            type="button"
            className={`seat-card ${active ? "seat-card--active" : ""}`}
            onClick={() => onSelectSeat(seat)}
          >
            <div className="seat-card__info">
              <div className={`seat-manager__portrait-frame seat-manager__portrait-frame--small`}>
                {seat.assigned && seat.spritePath ? (
                  <CharacterPortrait spritePath={seat.spritePath} name={seat.label} />
                ) : (
                  <span style={{ fontSize: 8, color: "var(--pixel-muted)" }}>空位</span>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 8,
                    color: "var(--pixel-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      color:
                        seat.seatType === "agent" ? "var(--pixel-accent)" : "var(--pixel-muted)",
                    }}
                  >
                    {seatTypeIcon(seat.seatType)}
                  </span>
                  工位 {index + 1}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {seat.assigned ? seat.label : "空工位"}
                </div>
                <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4 }}>
                  {seat.assigned
                    ? (seat.roleTitle ?? (seat.seatType === "agent" ? "智能成员" : "普通成员"))
                    : "未安排"}
                </div>
              </div>
              <div
                className={`seat-card__status ${seat.status === "running" ? "seat-card__status--running" : ""}`}
                style={{
                  color: !seat.assigned ? "var(--pixel-muted)" : "var(--pixel-text)",
                }}
              >
                {statusLabel}
              </div>
            </div>
            <div className="seat-card__summary">{seatSummary(seat)}</div>
          </button>
        );
      })}
    </div>
  );
}
