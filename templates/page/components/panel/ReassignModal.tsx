"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import { isTaskDone, memberStatusText, type OfficeTask } from "@/lib/office-data";
import { useOfficeData } from "@/lib/office-sync";
import { OFFICE_CONFIG } from "@/lib/office-config";
import { emitOperationLog, useOperationLog } from "@/lib/operation-log";
import CharacterPortrait from "@/components/hud/CharacterPortrait";

function tasksForMember(office: ReturnType<typeof useOfficeData>, name: string) {
  return [...office.getTasksForMember(name)].sort((a, b) => {
    const doneScore = Number(isTaskDone(a)) - Number(isTaskDone(b));
    if (doneScore !== 0) return doneScore;
    return (a.projectName ?? "").localeCompare(b.projectName ?? "", "zh-CN") || a.title.localeCompare(b.title, "zh-CN");
  });
}

function activeTaskCountForMember(office: ReturnType<typeof useOfficeData>, name: string) {
  return office.getTasksForMember(name).filter((task) => !isTaskDone(task)).length;
}

export default function ReassignModal() {
  const { state, assignTask } = useStudio();
  const office = useOfficeData();
  const { updateLog } = useOperationLog();
  const [payload, setPayload] = useState<{ seatId: string; taskId?: string } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const elapsedTimer = useRef<number | null>(null);
  // 待解锁意图：未解锁时点击"建议调整负责人"，先弹管理员验证，解锁后自动打开面板
  const pendingIntentRef = useRef<{ seatId: string; taskId?: string } | null>(null);
  // 最新 isAdmin 用 ref 保存，避免监听器随状态重建导致事件静默丢失（"点不动"根因）
  const isAdminRef = useRef(office.isAdmin);
  isAdminRef.current = office.isAdmin;

  const openPanel = (seatId: string, taskId?: string) => {
    setPayload({ seatId, taskId });
    setSelectedTaskId(taskId ?? "");
    setSelectedMember("");
    setReason("");
    setNotice(null);
    setSubmitting(false);
    stopTimer();
  };

  const stopTimer = () => {
    if (elapsedTimer.current != null) {
      window.clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
    setElapsed(0);
    setSlowHint(false);
  };

  useEffect(() => {
    // 入口事件：未解锁先弹验证并记住意图，解锁后自动打开（无需用户再点一次）
    const offOpen = gameEvents.on("open-reassign-panel", (seatId, taskId) => {
      if (!isAdminRef.current) {
        pendingIntentRef.current = { seatId, taskId };
        gameEvents.emit("request-admin");
        return;
      }
      openPanel(seatId, taskId);
    });
    // 解锁完成：若有待处理意图，自动打开面板
    const offUnlocked = gameEvents.on("admin-unlocked", () => {
      const intent = pendingIntentRef.current;
      if (intent) {
        pendingIntentRef.current = null;
        openPanel(intent.seatId, intent.taskId);
      }
    });
    return () => {
      offOpen();
      offUnlocked();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seat = useMemo(
    () => state.seats.find((item) => item.seatId === payload?.seatId),
    [payload?.seatId, state.seats],
  );
  const owner = seat ? office.getMemberByName(seat.label) : undefined;
  const ownerTasks = owner ? tasksForMember(office, owner.name) : [];
  const task: OfficeTask | undefined =
    office.snapshot.tasks.find((item) => item.id === (selectedTaskId || payload?.taskId)) ??
    ownerTasks[0];
  const recommendation = task && owner ? office.recommendAssignee(task, owner.name) : undefined;
  // 可选接手人来自全局成员池；地图座位只影响动画，不限制负责人候选。
  const candidateMembers = office.snapshot.members.filter((member) => member.name !== owner?.name);

  useEffect(() => {
    if (!selectedTaskId && task) setSelectedTaskId(task.id);
    // 优先自动选中推荐人；无推荐时自动选中第一个可选成员，确保确认按钮始终可点
    if (!selectedMember) {
      if (recommendation) setSelectedMember(recommendation.name);
      else if (candidateMembers[0]) setSelectedMember(candidateMembers[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation, selectedMember, selectedTaskId, task, candidateMembers.length]);

  if (!payload || !seat || !owner || !task) return null;

  const currentLoad = memberStatusText(owner);
  const chosen = office.getMemberByName(selectedMember);
  const chosenSeat = state.seats.find((item) => item.label === selectedMember);
  const taskProject = task.projectName ?? "项目未识别";
  // 负责人兜底提醒：若当前负责人是表格维护人，且这是他最后一条未完成任务，
  // 换走后负责人将无任务可管理，需明确提示（但仍允许操作，由管理员决定）
  const isOwnerLastTask =
    owner.name === OFFICE_CONFIG.ownerName &&
    activeTaskCountForMember(office, owner.name) <= 1;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 60, background: "rgba(0,0,0,0.45)", pointerEvents: "auto", padding: 20 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setPayload(null);
      }}
    >
      <div className="pixel-panel" style={{ width: "min(720px, 96vw)", maxHeight: "88vh", overflow: "auto", padding: 18 }}>
        <div className="flex items-start justify-between" style={{ gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16 }}>建议调整负责人</div>
            <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5 }}>
              AI 只提供建议，最终由领导选择确认。确认后只改飞书任务负责人，不自动完成任务。
            </div>
          </div>
          <button className="pixel-icon-btn" onClick={() => setPayload(null)} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div className="pixel-panel" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
            <div className="hud-panel__label">待调整任务</div>
            <select
              className="pixel-input hud-panel__input"
              value={selectedTaskId}
              onChange={(event) => {
                setSelectedTaskId(event.target.value);
                setSelectedMember("");
                setNotice(null);
              }}
            >
              {ownerTasks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.projectName ?? "项目未识别"} · {item.title} · {item.remainingText || item.status}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 8 }}>
              项目：{taskProject} · 当前负责人：{owner.name} · {currentLoad}
            </div>
          </div>

          <div className="pixel-panel" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
            <div className="hud-panel__label">推荐接手人</div>
            {recommendation ? (
              <div className="flex items-center" style={{ gap: 10 }}>
                <div className="seat-manager__portrait-frame seat-manager__portrait-frame--small">
                  {state.seats.find((item) => item.label === recommendation.name)?.spritePath ? (
                    <CharacterPortrait
                      spritePath={state.seats.find((item) => item.label === recommendation.name)!.spritePath!}
                      name={recommendation.name}
                    />
                  ) : null}
                </div>
                <div>
                  <div style={{ fontSize: 12 }}>{recommendation.name}</div>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4 }}>
                    {recommendation.role} · 当前 {recommendation.activeTasks} 进行中
                  </div>
                  <div style={{ fontSize: 8, color: "var(--pixel-accent)", marginTop: 4 }}>
                    推荐理由：负载较低，岗位/任务类型更匹配
                  </div>
                </div>
              </div>
            ) : (
              <div className="seat-hint">暂无可推荐人选，请在下方手动选择。</div>
            )}
          </div>
        </div>

        <div className="hud-panel__label">领导确认接手人</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          {candidateMembers.map((member) => {
            const active = selectedMember === member.name;
            const memberTasks = tasksForMember(office, member.name);
            const activeTaskCount = activeTaskCountForMember(office, member.name);
            const projectCount = new Set(memberTasks.map((item) => item.projectId).filter(Boolean)).size;
            const taskSummary = memberTasks.slice(0, 2).map((item) => item.title).join("、");
            return (
              <button
                key={member.id}
                type="button"
                className={`pixel-button ${active ? "pixel-button--primary" : ""}`}
                style={{ textAlign: "left", padding: 10, fontSize: 8 }}
                onClick={() => {
                  setSelectedMember(member.name);
                  setNotice(null);
                }}
              >
                <div style={{ fontSize: 10 }}>{member.name} · {member.role}</div>
                <div style={{ marginTop: 5, color: active ? "white" : "var(--pixel-muted)" }}>
                  项目×{projectCount} · 当前 {activeTaskCount} 个未完成
                </div>
                <div style={{ marginTop: 5, color: active ? "white" : "var(--pixel-muted)" }}>
                  任务：{taskSummary || "暂无任务"}
                </div>
              </button>
            );
          })}
        </div>

        <div className="hud-panel__label">调整原因</div>
        <textarea
          className="pixel-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="可选，例如：任务超期，先转给当前负载更低的成员推进"
          style={{ minHeight: 64, marginBottom: 12 }}
        />

        <div className="seat-hint" style={{ marginBottom: 12 }}>
          本次会把「{task.title}」从 {owner.name} 调整给 {selectedMember || "待选择成员"}。
        </div>

        {notice && (
          <div
            className="seat-hint"
            style={{
              marginBottom: 12,
              borderColor: notice.tone === "ok" ? "var(--pixel-green)" : "var(--pixel-red)",
              color: notice.tone === "ok" ? "var(--pixel-green)" : "var(--pixel-red)",
            }}
          >
            {notice.text}
          </div>
        )}

        {slowHint && submitting && (
          <div
            className="seat-hint"
            style={{ marginBottom: 12, borderColor: "var(--pixel-yellow)", color: "var(--pixel-yellow)" }}
          >
            飞书仍在处理，请继续等待，不要重复提交。
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {isOwnerLastTask && (
            <div
              className="seat-hint"
              style={{
                marginRight: "auto",
                alignSelf: "center",
                borderColor: "var(--pixel-yellow)",
                color: "var(--pixel-yellow)",
                fontSize: 8,
              }}
            >
              ⚠️ 这是负责人的最后一条未完成事项，换走后负责人将无事项可管理（负责人仍会保留在页面）。
            </div>
          )}
          <button className="pixel-button" onClick={() => setPayload(null)}>
            取消
          </button>
          <button
            className="pixel-button pixel-button--primary"
            disabled={!chosen || submitting}
            onClick={async () => {
              if (!chosen) return;
              // 管理操作需管理员口令：未解锁先弹验证（双保险，覆盖所有入口）
              if (!office.isAdmin) {
                gameEvents.emit("request-admin");
                return;
              }
              setSubmitting(true);
              setNotice(null);
              const startedAt = Date.now();
              // 提交即记录：右下角立刻可见"正在写回飞书…"，关掉弹窗也能追踪
              const logId = emitOperationLog(
                `正在写回飞书：将「${task.title}」负责人从 ${owner.name} 调整给 ${chosen.name}…`,
                "pending",
              );
              elapsedTimer.current = window.setInterval(() => {
                setElapsed(Math.floor((Date.now() - startedAt) / 1000));
                if (Date.now() - startedAt > 15_000) setSlowHint(true);
              }, 1000);
              const result = await office.reassignTask(
                task.id,
                chosen.name,
                reason || "由 Office Live 小剧场调整负责人",
              );
              stopTimer();
              setSubmitting(false);
              if (!result.ok) {
                const text = result.error || "负责人写回失败，请稍后重试。";
                setNotice({ tone: "error", text });
                updateLog(
                  logId,
                  `负责人调整失败：「${task.title}」未能写回飞书。${text}`,
                  "error",
                );
                return;
              }
              setNotice({
                tone: "ok",
                text: `已写回飞书，并已读回确认（耗时 ${(result.elapsedMs ?? 0) / 1000} 秒）。`,
              });
              updateLog(
                logId,
                `${owner.name} 的「${task.title}」负责人调整给 ${chosen.name}，已同步飞书。`,
                "ok",
              );
              if (chosenSeat) {
                assignTask(`接手任务：${task.title}${reason ? `；原因：${reason}` : ""}`, chosenSeat.seatId);
              }
              window.setTimeout(() => setPayload(null), 1200);
            }}
          >
            {submitting ? `正在写回飞书...（${elapsed} 秒）` : "确认分配并写回飞书"}
          </button>
        </div>
      </div>
    </div>
  );
}
