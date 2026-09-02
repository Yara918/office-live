"use client";

import type { SeatState, SeatType, AgentConfig } from "@/types/game";
import CharacterPortrait from "../CharacterPortrait";
import SpritePreview from "./SpritePreview";

const ROLE_PRESETS = [
  "前端工程师",
  "后端工程师",
  "AI 助手",
  "产品经理",
  "设计师",
  "测试工程师",
  "研究员",
];

function seatStateLabel(seat: SeatState) {
  if (!seat.assigned) return "空位";
  if (seat.status === "empty") return "待命";
  if (seat.status === "returning") return "回工位";
  if (seat.status === "running") return "处理中";
  if (seat.status === "done") return "已完成";
  if (seat.status === "failed") return "异常";
  return seat.status;
}

export interface SeatDetailPanelProps {
  selectedSeat: SeatState;
  effectiveName: string;
  effectiveRoleTitle: string;
  effectiveSpriteKey: string;
  effectiveSpritePath: string;
  effectiveSeatType: SeatType;
  effectiveAgentConfig: AgentConfig | undefined;
  busy: boolean;
  canSave: boolean;
  agentsLoading: boolean;
  discoveredAgents: AgentConfig[];
  usedAgentIds: Set<string>;
  onNameChange: (value: string) => void;
  onRoleTitleChange: (value: string) => void;
  onSpriteSelect: (spriteKey: string, spritePath: string, spriteLabel: string) => void;
  onSelectAgent: (agent: AgentConfig) => void;
  onSave: () => void;
  onUnassign: () => void;
  onClose: () => void;
  isAuggie?: boolean;
}

export default function SeatDetailPanel({
  selectedSeat,
  effectiveName,
  effectiveRoleTitle,
  effectiveSpriteKey,
  effectiveSpritePath,
  effectiveSeatType,
  effectiveAgentConfig,
  busy,
  canSave,
  agentsLoading,
  discoveredAgents,
  usedAgentIds,
  onNameChange,
  onRoleTitleChange,
  onSpriteSelect,
  onSelectAgent,
  onSave,
  onUnassign,
  onClose,
  isAuggie,
}: SeatDetailPanelProps) {
  return (
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto",
        gap: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
        <div className="seat-manager__portrait-frame seat-manager__portrait-frame--large">
          {effectiveSpritePath ? (
            <CharacterPortrait
              spritePath={effectiveSpritePath}
              name={effectiveName || "成员预览"}
              large
            />
          ) : (
            <div style={{ fontSize: 8, color: "var(--pixel-muted)" }}>未安排成员</div>
          )}
        </div>

        <div className="hud-panel__stack" style={{ gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12 }}>
                {selectedSeat.assigned ? effectiveName || selectedSeat.label : "空工位"}
              </div>
              <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4 }}>
                {selectedSeat.seatId} · facing {selectedSeat.spawnFacing ?? "down"}
                {effectiveSeatType === "agent" && effectiveAgentConfig && (
                  <span style={{ color: "var(--pixel-accent)", marginLeft: 6 }}>
                    agent:{effectiveAgentConfig.agentId}
                  </span>
                )}
              </div>
            </div>
            <div
              style={{
                fontSize: 7,
                padding: "4px 8px",
                background: "rgba(255,255,255,0.06)",
                color: selectedSeat.assigned ? "var(--pixel-text)" : "var(--pixel-muted)",
              }}
            >
              {seatStateLabel(selectedSeat)}
            </div>
          </div>

          {/* Name + (Agent selector) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: effectiveSeatType === "agent" ? "1fr 1fr" : "1fr",
              gap: 8,
            }}
          >
            <div>
              <label className="hud-panel__label">姓名</label>
              <input
                className="pixel-input hud-panel__input"
                value={effectiveName}
                onChange={(event) => onNameChange(event.target.value)}
                disabled={busy}
                placeholder="成员姓名"
                style={{ minHeight: 0 }}
              />
            </div>
            {effectiveSeatType === "agent" && (
              <div>
                <label className="hud-panel__label">智能体</label>
                {agentsLoading ? (
                  <div
                    className="pixel-input hud-panel__input"
                    style={{
                      minHeight: 0,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 8,
                      color: "var(--pixel-muted)",
                    }}
                  >
                    扫描中...
                  </div>
                ) : discoveredAgents.length === 0 ? (
                  <div
                    className="pixel-input hud-panel__input"
                    style={{
                      minHeight: 0,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 8,
                      color: "var(--pixel-muted)",
                    }}
                  >
                    {isAuggie ? "当前模式不可选智能体" : "未发现智能体"}
                  </div>
                ) : (
                  <select
                    className="pixel-input hud-panel__input"
                    style={{ minHeight: 0 }}
                    value={effectiveAgentConfig?.agentId ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const agent = discoveredAgents.find((a) => a.agentId === e.target.value);
                      if (agent) onSelectAgent(agent);
                    }}
                  >
                    <option value="">-- 选择 --</option>
                    {discoveredAgents.map((agent) => {
                      const isUsed = usedAgentIds.has(agent.agentId);
                      const label = `${agent.identity?.emoji ?? "◆"} ${agent.identity?.name ?? agent.agentId}`;
                      return (
                        <option key={agent.agentId} value={agent.agentId} disabled={isUsed}>
                          {isUsed ? `${label} (已安排)` : label}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="hud-panel__label">岗位 / 角色</label>
            <input
              className="pixel-input hud-panel__input"
              value={effectiveRoleTitle}
              onChange={(event) => onRoleTitleChange(event.target.value)}
              disabled={busy}
              placeholder="岗位名称"
              style={{ minHeight: 0 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {ROLE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pixel-button"
                  style={{ fontSize: 7, padding: "4px 6px" }}
                  disabled={busy}
                  onClick={() => onRoleTitleChange(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="seat-hint">
        {busy
          ? "这个工位正在处理任务，完成或停止后才能换人。"
          : effectiveSeatType === "agent"
            ? isAuggie
              ? "当前模式不支持智能体工位，请切回普通成员。"
              : "选择一个智能体和人物形象后保存。"
            : "选择人物形象，填写姓名和岗位后保存。"}
      </div>

      <SpritePreview
        selectedSpriteKey={effectiveSpriteKey}
        busy={busy}
        onSelectSprite={onSpriteSelect}
      />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          className="pixel-button"
          onClick={onUnassign}
          disabled={!selectedSeat.assigned || busy}
        >
          移除成员
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pixel-button" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={onSave}
            disabled={!canSave}
          >
            {selectedSeat.assigned
              ? "保存修改"
              : effectiveSeatType === "agent"
                ? "安排智能体"
                : "安排成员"}
          </button>
        </div>
      </div>
    </div>
  );
}
