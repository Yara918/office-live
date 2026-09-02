"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useOfficeData } from "@/lib/office-sync";
import type { SeatState } from "@/types/game";
import CharacterPortrait from "./CharacterPortrait";
import type { HudDockItem, HudPanelId } from "./HudDock";

interface TopBarProps {
  seats: SeatState[];
  toolItems: HudDockItem[];
  openPanel: HudPanelId | null;
  onToggle: (id: HudPanelId) => void;
  iconOverrides?: Partial<Record<HudPanelId, string>>;
  onSeatClick?: (seatId: string) => void;
}

function seatDotColor(seat: SeatState): string {
  if (!seat.assigned) return "gray";
  if (seat.status === "running" || seat.status === "returning") return "yellow";
  if (seat.status === "failed") return "red";
  return "green";
}

export default function TopBar({
  seats,
  toolItems,
  openPanel,
  onToggle,
  iconOverrides,
  onSeatClick,
}: TopBarProps) {
  const assignedSeats = seats.filter((seat) => seat.assigned);
  const { snapshot, loading, error } = useOfficeData();
  const [overviewOpen, setOverviewOpen] = useState(false);
  const analysis = snapshot.analysis;

  const overviewFacts = useMemo(() => {
    const facts: { label: string; value: string }[] = [];
    facts.push({ label: "成员", value: String(snapshot.members.length) });
    facts.push({ label: "事项", value: String(snapshot.tasks.length) });
    if (snapshot.projects.length) facts.push({ label: "项目", value: String(snapshot.projects.length) });
    const attention = snapshot.tasks.filter((task) => task.overdue || task.dueSoon).length;
    if (attention > 0) facts.push({ label: "关注", value: String(attention) });
    return facts.slice(0, 4);
  }, [analysis, snapshot.members.length, snapshot.projects.length, snapshot.tables, snapshot.tasks.length]);
  const relatedMemberCount = useMemo(() => {
    const names = new Set<string>();
    snapshot.tasks.forEach((task) => {
      task.owner
        .split(/[、,，;；]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
    });
    return names.size;
  }, [snapshot.tasks]);

  return (
    <div className="layout-top">
      <div className="layout-topbar__title" style={{ position: "relative" }}>
        <span className="layout-topbar__logo">{snapshot.baseTitle}</span>
        <button
          type="button"
          className="pixel-button"
          onClick={() => setOverviewOpen((current) => !current)}
          style={{
            fontFamily: "inherit",
            fontSize: 9,
            fontWeight: 400,
            lineHeight: 1,
            padding: "5px 8px",
            marginLeft: 10,
          }}
        >
          团队概览 {overviewOpen ? "收起" : "展开"}
        </button>
        {(loading || snapshot.source !== "feishu" || error) && (
          <span
            className="seat-hint"
            style={{
              display: "inline-block",
              marginLeft: 8,
              padding: "4px 7px",
              color: "var(--pixel-yellow)",
            }}
          >
            {loading ? "正在同步飞书数据" : snapshot.source !== "feishu" ? "正在连接飞书" : "同步重试中"}
          </span>
        )}
        {overviewOpen && (
          <div
            className="pixel-panel"
            style={{
              position: "absolute",
              top: 38,
              left: 0,
              width: "min(520px, 92vw)",
              maxHeight: "68vh",
              overflow: "auto",
              padding: 12,
              zIndex: 80,
              background: "rgba(37, 34, 25, 0.96)",
            }}
          >
            <div className="hud-panel__label" style={{ marginBottom: 8 }}>团队概览</div>
            <div className="seat-hint" style={{ marginBottom: 8, color: "var(--pixel-yellow)", lineHeight: 1.6 }}>
              电脑睡眠、重启、关机、断电，或启动页面的窗口被关闭后，页面服务就会停止运行，届时请对当前 AI 说一句“帮我启动 Office Live 页面”，AI 会自动把服务拉起来，然后刷新页面即可。
            </div>
            {snapshot.source !== "feishu" && (
              <div className="seat-hint" style={{ marginBottom: 8, color: "var(--pixel-yellow)" }}>
                正在读取飞书多维表格；同步完成后会自动替换为实时团队和任务数据。
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {overviewFacts.map((fact) => (
                <div key={fact.label} className="seat-hint">
                  {fact.label} {fact.value}
                </div>
              ))}
            </div>
            {relatedMemberCount > assignedSeats.length && (
              <div className="seat-hint" style={{ marginTop: 8, color: "var(--pixel-yellow)" }}>
                当前 {relatedMemberCount} 人有相关事项，地图展示 {assignedSeats.length} 人，另有{" "}
                {relatedMemberCount - assignedSeats.length} 人在详情和候选中。
              </div>
            )}

            {analysis && (
              <>
                {analysis.insights.length > 0 && (
                  <div className="hud-panel__stack" style={{ gap: 6, marginTop: 6 }}>
                    {analysis.insights.slice(0, 5).map((insight) => (
                      <div key={insight.id} className="pixel-panel" style={{ padding: 8, background: "rgba(255,255,255,0.04)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 9, fontWeight: 700 }}>{insight.title}</span>
                        </div>
                        <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4, lineHeight: 1.6 }}>
                          {insight.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="layout-topbar__agents">
        {assignedSeats.map((seat) => (
          <button
            key={seat.seatId}
            type="button"
            className={`topbar-agent-pill ${
              seat.status === "running" || seat.status === "returning"
                ? "topbar-agent-pill--active"
                : ""
            }`}
            onClick={() => onSeatClick?.(seat.seatId)}
            title={`${seat.label} · ${seat.status}`}
          >
            <div className="topbar-agent-pill__avatar">
              <CharacterPortrait spritePath={seat.spritePath} name={seat.label} />
            </div>
            <span className="topbar-agent-pill__name">{seat.label}</span>
            <span className={`pixel-dot pixel-dot--${seatDotColor(seat)}`} />
          </button>
        ))}
        {assignedSeats.length === 0 && <span className="topbar-agent-pill__empty">暂无成员</span>}
      </div>

      <div className="layout-topbar__tools">
        {toolItems.map((item) => {
          const active = openPanel === item.id;
          const override = iconOverrides?.[item.id];
          const src = override ?? (active ? item.iconActive : item.icon);
          return (
            <button
              key={item.id}
              type="button"
              data-dock-id={item.id}
              onClick={() => onToggle(item.id)}
              title={item.label}
              className={`topbar-tool-btn ${active ? "topbar-tool-btn--active" : ""}`}
            >
              <Image
                src={src}
                alt={item.label}
                width={24}
                height={24}
                style={{ imageRendering: "pixelated", display: "block" }}
                unoptimized
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
