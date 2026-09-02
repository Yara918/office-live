"use client";

import { useMemo, useState } from "react";
import { gameEvents, type OfficeActivityMode } from "@/lib/events";
import { emitOperationLog } from "@/lib/operation-log";
import { useOfficeData } from "@/lib/office-sync";
import { useStudio } from "@/lib/store";
import { OFFICE_CONFIG } from "@/lib/office-config";

/** 互动玩法按办公场景分区：每个区域都有对应的互动，成员会走到对应位置 */
type SceneGroup = {
  key: string;
  label: string;
  icon: string;
  actions: Array<{ mode: OfficeActivityMode; label: string; hint: string }>;
};

const SCENE_GROUPS: SceneGroup[] = [
  {
    key: "work",
    label: "办公区",
    icon: "💻",
    actions: [
      { mode: "focus", label: "专注工作", hint: "回到工位处理当前任务" },
      { mode: "thinking", label: "思考方案", hint: "显示思考和梳理状态" },
      { mode: "music", label: "听歌工作", hint: "轻松办公状态" },
      { mode: "copy", label: "复印资料", hint: "到打印机旁复印文件" },
      { mode: "handover", label: "交接工作", hint: "和同事交接任务细节" },
      { mode: "device_check", label: "设备调试", hint: "到右侧工作台调试设备" },
      { mode: "roundtable", label: "白板复盘", hint: "到白板前一起复盘方案" },
    ],
  },
  {
    key: "meet",
    label: "会议区",
    icon: "📋",
    actions: [
      { mode: "group", label: "项目小会", hint: "发起人与勾选成员沟通项目进展" },
      { mode: "group", label: "白板评审", hint: "到白板旁评审方案" },
      { mode: "group", label: "需求对齐", hint: "围绕需求、交付和风险做短沟通" },
      { mode: "group", label: "资料传递", hint: "成员之间传递资料和同步信息" },
      { mode: "brainstorm", label: "头脑风暴", hint: "到白板前一起发散想法" },
      { mode: "standup", label: "站会同步", hint: "全员围在一起同步进展" },
      { mode: "demo", label: "成果演示", hint: "向团队演示当前成果" },
      { mode: "review", label: "进度评审", hint: "与成员对齐工作进展（负责人）" },
    ],
  },
  {
    key: "rest",
    label: "休息区",
    icon: "🛋️",
    actions: [
      { mode: "rest", label: "右侧小坐", hint: "到右侧复盘区小坐休息" },
      { mode: "drink", label: "喝水休息", hint: "到饮水机接水休息" },
      { mode: "coffee", label: "冲杯咖啡", hint: "提神续命" },
      { mode: "chat", label: "闲聊沟通", hint: "在休息区和同事闲聊" },
      { mode: "lunch", label: "午间用餐", hint: "到右侧餐桌一起吃个饭" },
      { mode: "teambuild", label: "团建小游戏", hint: "放松一下增进感情" },
    ],
  },
  {
    key: "study",
    label: "学习区",
    icon: "📚",
    actions: [
      { mode: "read", label: "翻阅资料", hint: "到书架旁查看文档资料" },
      { mode: "book_read", label: "图书角阅读", hint: "到右侧图书角安静阅读" },
      { mode: "walk", label: "走廊踱步", hint: "到右侧走廊走走理思路" },
      { mode: "exercise", label: "起身锻炼", hint: "活动一下身体" },
      { mode: "game", label: "摸鱼游戏", hint: "到右侧桌椅区摸鱼放松" },
      { mode: "stretch", label: "舒展拉伸", hint: "缓解久坐疲劳" },
      { mode: "plant", label: "打理绿植", hint: "给办公室绿植浇浇水" },
    ],
  },
];

// 负责人专属动作（发起人=负责人时显示）
const OWNER_ACTIONS: Array<{ mode: OfficeActivityMode; label: string; hint: string }> = [
  { mode: "delegate", label: "安排工作", hint: "把任务委派给指定成员" },
  { mode: "kpi", label: "绩效沟通", hint: "与成员做一对一绩效沟通" },
  { mode: "negotiate", label: "洽谈沟通", hint: "与成员围桌洽谈方案" },
];

export default function PlayControlPanel() {
  const { state } = useStudio();
  const { snapshot, loading, error, refresh, lastSyncText } = useOfficeData();
  const members = useMemo(() => state.seats.filter((seat) => seat.assigned), [state.seats]);
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
  const [collapsed, setCollapsed] = useState(true);
  const [actorSeatId, setActorSeatId] = useState("");
  const [targetSeatIds, setTargetSeatIds] = useState<string[]>([]);
  const [activeScene, setActiveScene] = useState("work");

  const actor = actorSeatId || members[0]?.seatId || "";
  const actorLabel = members.find((seat) => seat.seatId === actor)?.label ?? "";
  const isOwnerActor = actorLabel === OFFICE_CONFIG.ownerName;
  const scene = SCENE_GROUPS.find((g) => g.key === activeScene) ?? SCENE_GROUPS[0];

  const toggleTarget = (seatId: string) => {
    setTargetSeatIds((current) =>
      current.includes(seatId)
        ? current.filter((item) => item !== seatId)
        : [...current, seatId],
    );
  };

  const run = (mode: OfficeActivityMode, label: string) => {
    const isGroupAction = ["group", "standup", "brainstorm", "demo", "review", "teambuild", "negotiate", "roundtable", "chat", "handover", "focus_group", "oneToOne"].includes(mode);
    // 多人动作：没勾选时自动补参与人；单人动作：没勾选时只有发起人自己
    const fallbackTargets = isGroupAction
      ? members.filter((seat) => seat.seatId !== actor).slice(0, 3).map((seat) => seat.seatId)
      : [];
    const selectedTargets = targetSeatIds.length > 0 ? targetSeatIds : fallbackTargets;
    const actorName = members.find((seat) => seat.seatId === actor)?.label ?? "成员";
    const targetLabels = selectedTargets
      .map((seatId) => members.find((seat) => seat.seatId === seatId)?.label)
      .filter(Boolean)
      .join("、");

    gameEvents.emit("office-activity", {
      mode,
      actorSeatId: actor,
      targetSeatIds: selectedTargets,
    });

    emitOperationLog(
      targetLabels
        ? `互动-${actorName}${label}（与 ${targetLabels}）`
        : `互动-${actorName}${label}`,
      "info",
    );

    window.setTimeout(() => {
      emitOperationLog(`互动-${actorName}${label}已完成`, "ok");
    }, isGroupAction ? 9000 : 6500);
  };

  if (members.length === 0) return null;

  if (collapsed) {
    return (
      <div
        className="pixel-panel"
        style={{
          position: "absolute",
          left: 12,
          bottom: 74,
          zIndex: 45,
          width: 156,
          padding: 8,
          pointerEvents: "auto",
          background: "rgba(37, 34, 25, 0.9)",
        }}
      >
        <button
          type="button"
          className="pixel-button pixel-button--primary"
          onClick={() => setCollapsed(false)}
          style={{ width: "100%", fontSize: 9, padding: "7px 8px" }}
        >
          互动玩法 · 展开
        </button>
      </div>
    );
  }

  return (
    <div
      className="pixel-panel"
      style={{
        position: "absolute",
        left: 12,
        bottom: 74,
        zIndex: 45,
        width: 300,
        maxHeight: "62vh",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        background: "rgba(37, 34, 25, 0.94)",
      }}
    >
      <div className="flex items-center justify-between" style={{ gap: 8, padding: "10px 10px 6px" }}>
        <div>
          <div style={{ fontSize: 12 }}>互动玩法</div>
          <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 3 }}>
            {loading ? "同步中" : `上次同步 ${lastSyncText}`}
          </div>
        </div>
        <button
          type="button"
          className="pixel-button"
          onClick={() => setCollapsed(true)}
          style={{ fontSize: 8, padding: "5px 7px" }}
        >
          收起
        </button>
      </div>

      {/* 场景分区标签 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 4,
          padding: "0 10px 6px",
        }}
      >
        {SCENE_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`pixel-button ${activeScene === g.key ? "pixel-button--primary" : ""}`}
            onClick={() => setActiveScene(g.key)}
            style={{ fontSize: 8, padding: "5px 2px" }}
          >
            {g.icon} {g.label}
          </button>
        ))}
      </div>

      <div style={{ overflow: "auto", padding: "0 10px 6px", flex: "1 1 auto" }}>
        {relatedMemberCount > members.length && (
          <div className="seat-hint" style={{ marginBottom: 6, fontSize: 8, color: "var(--pixel-yellow)" }}>
            当前 {relatedMemberCount} 人有相关事项，地图展示 {members.length} 人，另有{" "}
            {relatedMemberCount - members.length} 人在详情和候选中。
          </div>
        )}
        {error && <div className="seat-hint" style={{ marginBottom: 6, fontSize: 8 }}>{error}</div>}

        <label className="hud-panel__label">发起人</label>
        <select
          className="pixel-input hud-panel__input"
          value={actor}
          onChange={(event) => setActorSeatId(event.target.value)}
          style={{ marginBottom: 6 }}
        >
          {members.map((seat) => (
            <option key={seat.seatId} value={seat.seatId}>
              {seat.label} · {seat.roleTitle ?? "成员"}
            </option>
          ))}
        </select>

        <div className="hud-panel__label">参与人</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            marginBottom: 8,
            maxHeight: 84,
            overflow: "auto",
          }}
        >
          {members
            .filter((seat) => seat.seatId !== actor)
            .map((seat) => (
              <label
                key={seat.seatId}
                className="pixel-panel"
                style={{
                  padding: "5px 6px",
                  fontSize: 9,
                  background: targetSeatIds.includes(seat.seatId)
                    ? "rgba(201, 162, 39, 0.22)"
                    : "rgba(255,255,255,0.04)",
                }}
              >
                <input
                  type="checkbox"
                  checked={targetSeatIds.includes(seat.seatId)}
                  onChange={() => toggleTarget(seat.seatId)}
                  style={{ marginRight: 4 }}
                />
                {seat.label}
              </label>
            ))}
        </div>

        <div
          style={{
            fontSize: 8,
            color: "var(--pixel-accent)",
            marginBottom: 4,
            paddingLeft: 2,
          }}
        >
          {scene.icon} {scene.label}玩法
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          {scene.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="pixel-button"
              title={action.hint}
              onClick={() => run(action.mode, action.label)}
              style={{ fontSize: 8, padding: "6px 5px" }}
            >
              {action.label}
            </button>
          ))}
        </div>

        {isOwnerActor && (
          <>
            <div
              style={{
                fontSize: 8,
                color: "var(--pixel-accent)",
                marginTop: 8,
                marginBottom: 4,
                paddingLeft: 2,
              }}
            >
              ⭐ 负责人专属动作
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {OWNER_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="pixel-button pixel-button--primary"
                  title={action.hint}
                  onClick={() => run(action.mode, action.label)}
                  style={{ fontSize: 8, padding: "6px 5px" }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          type="button"
          className="pixel-button"
          onClick={() => void refresh(true)}
          style={{ fontSize: 8, padding: "6px 5px", marginTop: 8, width: "100%" }}
        >
          强制刷新飞书
        </button>
      </div>
    </div>
  );
}
