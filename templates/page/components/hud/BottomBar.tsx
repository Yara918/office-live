"use client";

import { Database, Sparkles, Users } from "lucide-react";
import type { SeatState } from "@/types/game";

interface BottomBarProps {
  seats: SeatState[];
}

export default function BottomBar({ seats }: BottomBarProps) {
  const totalSeats = seats.length;
  const assignedSeats = seats.filter((seat) => seat.assigned).length;
  const workingCount = seats.filter(
    (seat) => seat.assigned && (seat.status === "running" || seat.status === "returning"),
  ).length;

  return (
    <div className="layout-bottombar">
      <div className="hud-pill hud-pill--connection">
        <span className="pixel-dot pixel-dot--green" />
        <Database size={10} />
        <span>飞书数据</span>
      </div>
      <div className="hud-pill hud-pill--model">
        <Sparkles size={10} />
        <span>本地运行</span>
      </div>
      <div className="hud-pill hud-pill--metric">
        <Users size={10} />
        <span>
          {assignedSeats}/{totalSeats} 工位
        </span>
      </div>
      <div className="hud-pill hud-pill--metric">
        <Sparkles size={10} />
        <span>
          {workingCount}/{assignedSeats || 0} 互动中
        </span>
      </div>
      <div className="hud-pill hud-pill--metric">
        <span>状态：红色需关注 · 黄色处理中 · 绿色正常</span>
      </div>
    </div>
  );
}
