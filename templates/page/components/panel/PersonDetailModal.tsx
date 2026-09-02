"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import {
  fieldValueText,
  fieldDisplayText,
  isTaskDone,
  isTaskDueSoon,
  isTaskRunning,
  isTaskTodo,
  memberStatusText,
  personComparableName,
  type OfficeTask,
} from "@/lib/office-data";
import { useOfficeData } from "@/lib/office-sync";
import { tableTitle, tableConfig } from "@/lib/office-config";
import CharacterPortrait from "@/components/hud/CharacterPortrait";

type TaskGroup = {
  key: string;
  title: string;
  hint: string;
  tone: string;
  tasks: OfficeTask[];
};

function priorityScore(task: OfficeTask) {
  if (task.overdue && !isTaskDone(task)) return 0;
  if (isTaskDueSoon(task)) return 1;
  if (task.priority.includes("P0")) return 2;
  if (isTaskRunning(task)) return 3;
  if (isTaskTodo(task)) return 4;
  if (isTaskDone(task)) return 5;
  return 6;
}

function statusTone(task: OfficeTask) {
  if (task.overdue && !isTaskDone(task)) return "var(--pixel-red)";
  if (isTaskDueSoon(task)) return "var(--pixel-yellow)";
  if (isTaskRunning(task)) return "var(--pixel-accent)";
  if (isTaskDone(task)) return "var(--pixel-green)";
  return "var(--pixel-muted)";
}

function isUsefulSummaryText(text: string, task: OfficeTask) {
  const clean = text.trim();
  if (!clean) return false;
  if (/^rec[a-zA-Z0-9]{8,}$/.test(clean)) return false;
  if (/^已关联\s*\d+\s*条$/.test(clean)) return false;
  return ![task.title, task.status, task.owner].includes(clean);
}

function taskSummaryParts(task: OfficeTask) {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(task.rawFields ?? {})) {
    const text = fieldDisplayText(field, value);
    if (!isUsefulSummaryText(text, task)) continue;
    parts.push(`${field}：${text}`);
    if (parts.length >= 3) return parts;
  }
  for (const text of [task.projectName, task.priority, task.type, task.dueDate ? `截止 ${task.dueDate}` : "", task.description]) {
    if (isUsefulSummaryText(text ?? "", task)) parts.push(text!);
    if (parts.length >= 3) break;
  }
  return parts;
}

function taskGroups(tasks: OfficeTask[]): TaskGroup[] {
  const classified = new Set<OfficeTask>();
  const groups: TaskGroup[] = [
    {
      key: "overdue",
      title: "超期事项",
      hint: "优先确认是否调整负责人",
      tone: "var(--pixel-red)",
      tasks: tasks.filter((task) => {
        const hit = task.overdue;
        if (hit) classified.add(task);
        return hit;
      }),
    },
    {
      key: "dueSoon",
      title: "临近交付",
      hint: "3 天内到期，关注交付节奏",
      tone: "var(--pixel-yellow)",
      tasks: tasks.filter((task) => {
        const hit = isTaskDueSoon(task) && !classified.has(task);
        if (hit) classified.add(task);
        return hit;
      }),
    },
  ];
  // 按真实状态值分组（不预设词表）：没有状态值时归入通用相关事项。
  const statusMap = new Map<string, OfficeTask[]>();
  for (const task of tasks) {
    if (classified.has(task)) continue;
    const key = task.status || "相关事项";
    if (!statusMap.has(key)) statusMap.set(key, []);
    statusMap.get(key)!.push(task);
  }
  for (const [status, statusTasks] of statusMap) {
    groups.push({
      key: `status-${status}`,
      title: status,
      hint: `${statusTasks.length} 项`,
      tone: "var(--pixel-text)",
      tasks: statusTasks,
    });
  }
  return groups.filter((group) => group.tasks.length > 0);
}

export default function PersonDetailModal() {
  const { state } = useStudio();
  const office = useOfficeData();
  const [seatId, setSeatId] = useState<string | null>(null);

  useEffect(() => {
    return gameEvents.on("open-person-detail", (nextSeatId) => setSeatId(nextSeatId));
  }, []);

  const seat = useMemo(
    () => state.seats.find((item) => item.seatId === seatId),
    [seatId, state.seats],
  );
  const member = seat ? office.getMemberByName(seat.label) : undefined;
  const subjectMap = office.snapshot.analysis?.subjectMap;
  const tableProfiles = office.snapshot.analysis?.tableProfiles ?? [];
  const personJourney = useMemo(
    () => (member ? office.snapshot.analysis?.personJourneys?.find((item) => item.name === member.name) : undefined),
    [member, office.snapshot.analysis?.personJourneys],
  );
  // 所有表记录（通用化核心）：该成员在所有表里、凡人员字段含他名字的记录
  // 有目的地展示：重点字段（名称/状态/日期/人员）必显，其余字段折叠（不堆砌）
  const allTableRecords = useMemo(() => {
    if (!member) return [];
    const result: {
      tableTitle: string;
      tableId: string;
      recordId: string;
      keyFields: [string, unknown][]; // 名称/状态/日期/人员（必显）
      otherFields: [string, unknown][]; // 其余字段（折叠）
    }[] = [];
    for (const t of office.snapshot.tables) {
      const profile = tableProfiles.find((item) => item.tableId === t.id);
      const mappedPeople = t.title === subjectMap?.mainTable ? subjectMap.people : [];
      const personFields = [
        ...mappedPeople,
        ...(profile?.personFields ?? []),
        ...Object.entries(t.fieldKinds)
          .filter(([, k]) => k === "person")
          .map(([name]) => name),
      ].filter((name, index, arr) => name && arr.indexOf(name) === index);
      if (personFields.length === 0) continue;
      const nameField = t.title === subjectMap?.mainTable ? subjectMap.workItem : Object.entries(t.fieldKinds).find(([, k]) => k === "name")?.[0];
      const statusFields = profile?.statusFields.length
        ? profile.statusFields
        : t.title === subjectMap?.mainTable
        ? subjectMap.statusFields
        : Object.entries(t.fieldKinds).filter(([, k]) => k === "status").map(([n]) => n);
      const dateFields = profile?.timeFields.length
        ? profile.timeFields
        : t.title === subjectMap?.mainTable
        ? subjectMap.timeFields
        : Object.entries(t.fieldKinds)
            .filter(([, k]) => k === "date")
            .map(([n]) => n);
      const businessFields = t.title === subjectMap?.mainTable ? subjectMap.businessSubjects : [];
      const valueFields = profile?.valueFields.length ? profile.valueFields : t.title === subjectMap?.mainTable ? subjectMap.valueFields : [];
      for (const rec of t.records) {
        const hit = personFields.some((pf) => {
          const v = fieldValueText(rec.fields[pf] ?? "");
          const target = personComparableName(member.name);
          return v.split(/[、,，;；]/).some((p) => {
            const clean = p.trim();
            return clean === member.name || (target !== "" && personComparableName(clean) === target);
          });
        });
        if (!hit) continue;
        // 重点字段只保留少量可读信息；关联等细节放入折叠区
        const keyFields: [string, unknown][] = [];
        const otherFields: [string, unknown][] = [];
        if (nameField && rec.fields[nameField] != null) keyFields.push([nameField, rec.fields[nameField]]);
        for (const bf of businessFields) if (rec.fields[bf] != null) keyFields.push([bf, rec.fields[bf]]);
        for (const sf of statusFields) if (rec.fields[sf] != null) keyFields.push([sf, rec.fields[sf]]);
        for (const vf of valueFields) if (rec.fields[vf] != null) keyFields.push([vf, rec.fields[vf]]);
        for (const df of dateFields) if (rec.fields[df] != null) keyFields.push([df, rec.fields[df]]);
        for (const pf of personFields) if (rec.fields[pf] != null) keyFields.push([pf, rec.fields[pf]]);
        const visibleKeys = keyFields
          .filter(([k]) => t.fieldKinds[k] !== "link")
          .filter(([k, v]) => fieldDisplayText(k, v).trim())
          .slice(0, 4);
        // 其余字段：不在重点里的，全部进折叠区
        const keySet = new Set(visibleKeys.map(([k]) => k));
        for (const [k, v] of Object.entries(rec.fields)) {
          if (!keySet.has(k) && v != null && fieldDisplayText(k, v).trim() !== "") otherFields.push([k, v]);
        }
        result.push({ tableTitle: t.title, tableId: t.id, recordId: rec.id, keyFields: visibleKeys, otherFields });
      }
    }
    return result;
  }, [member, office.snapshot.tables, subjectMap, tableProfiles]);
  const tasks = useMemo(
    () =>
      member
        ? [...office.getTasksForMember(member.name)].sort((a, b) => {
            const score = priorityScore(a) - priorityScore(b);
            if (score !== 0) return score;
            return a.dueDate.localeCompare(b.dueDate);
          })
        : [],
    [member, office],
  );
  const overdueTasks = tasks.filter((task) => task.overdue && !isTaskDone(task));
  const dueSoonTasks = tasks.filter(isTaskDueSoon);
  const runningTasks = tasks.filter((task) => isTaskRunning(task) && !task.overdue);
  const groups = taskGroups(tasks);
  const taskIds = new Set(tasks.map((task) => task.id));
  const projectIds = new Set(tasks.map((task) => task.projectId).filter(Boolean));
  const milestones = member
    ? office.snapshot.milestones.filter(
        (milestone) =>
          milestone.taskIds.some((taskId) => taskIds.has(taskId)) ||
          Boolean(milestone.projectId && projectIds.has(milestone.projectId)),
      )
    : [];
  milestones.forEach((milestone) => {
    if (milestone.projectId) projectIds.add(milestone.projectId);
  });
  const risks = member
    ? office.snapshot.risks.filter(
        (risk) =>
          risk.taskIds?.some((taskId) => taskIds.has(taskId)) ||
          Boolean(risk.projectId && projectIds.has(risk.projectId)),
      )
    : [];
  risks.forEach((risk) => {
    if (risk.projectId) projectIds.add(risk.projectId);
  });
  const projects = member
    ? office.snapshot.projects.filter((project) => projectIds.has(project.id))
    : [];
  const firstAdjustTask = overdueTasks[0] ?? dueSoonTasks[0] ?? runningTasks[0] ?? tasks[0];

  if (!seatId || !seat || !member) return null;

  const alertTone =
    overdueTasks.length > 0
      ? "var(--pixel-red)"
      : dueSoonTasks.length > 0
        ? "var(--pixel-yellow)"
        : "var(--pixel-green)";
  const alertText =
    overdueTasks.length > 0
      ? `${member.name} 当前有 ${overdueTasks.length} 个超期任务，建议优先确认是否需要调整负责人。`
      : dueSoonTasks.length > 0
        ? `${member.name} 有 ${dueSoonTasks.length} 个任务临近交付，请关注节奏。`
        : "当前无超期/临期事项，工作节奏正常。";

  return (
    <div
      className="absolute inset-0 flex items-center justify-end"
      style={{ zIndex: 55, background: "rgba(0,0,0,0.25)", pointerEvents: "auto", padding: 24 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setSeatId(null);
      }}
    >
      <div
        className="pixel-panel"
        style={{
          width: "min(560px, 94vw)",
          maxHeight: "88vh",
          overflow: "auto",
          padding: 18,
        }}
      >
        <div className="flex items-start justify-between" style={{ gap: 16, marginBottom: 14 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div className="seat-manager__portrait-frame seat-manager__portrait-frame--small">
              {seat.spritePath ? (
                <CharacterPortrait spritePath={seat.spritePath} name={seat.label} />
              ) : null}
            </div>
            <div>
              <div style={{ fontSize: 16, color: "var(--pixel-text)" }}>{member.name}</div>
              <div style={{ fontSize: 9, color: "var(--pixel-muted)", marginTop: 4 }}>
                {[
                  member.role || "",
                  member.level ? `${member.level}` : "",
                  member.employeeNo ? `工号 ${member.employeeNo}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "成员"}
              </div>
            </div>
          </div>
          <button className="pixel-icon-btn" onClick={() => setSeatId(null)} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="seat-hint" style={{ marginBottom: 12, borderColor: alertTone }}>
          <span style={{ color: alertTone, fontWeight: 700 }}>提醒：</span>
          {alertText}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 14,
          }}
        >
          {[["总事项", member.totalTasks], ...memberStatusText(member).split(" · ").map((s) => {
            const idx = s.lastIndexOf(" ");
            return [s.slice(0, idx), s.slice(idx + 1)];
          })].map(([label, value], i) => (
            <div
              key={`${String(label)}-${i}`}
              className="pixel-panel"
              style={{ padding: 10, textAlign: "center", background: "rgba(255,255,255,0.04)" }}
            >
              <div style={{ fontSize: 16, lineHeight: 1.2, fontWeight: 600 }}>{value}</div>
              <div style={{ fontSize: 9, color: "var(--pixel-muted)", marginTop: 4, lineHeight: 1.2 }}>{label}</div>
            </div>
          ))}
        </div>

        {personJourney && (personJourney.progress || personJourney.highlights.length > 0 || personJourney.recordCount > 0) && (
          <div style={{ marginBottom: 14 }}>
            <div className="hud-panel__label">旅程摘要</div>
            <div className="pixel-panel" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
              {personJourney.progress ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, gap: 12 }}>
                    <span>{personJourney.progress.label}</span>
                    <span>{personJourney.progress.text}</span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      border: "1px solid var(--pixel-border)",
                      marginTop: 8,
                      background: "rgba(0,0,0,0.35)",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, personJourney.progress.value))}%`,
                        height: "100%",
                        background: personJourney.progress.value >= 70 ? "var(--pixel-green)" : "var(--pixel-accent)",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 8, lineHeight: 1.6 }}>
                    {personJourney.progress.method}
                  </div>
                </>
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: personJourney.progress ? 10 : 0 }}>
                <span className="hud-status hud-status--running">相关记录 {personJourney.recordCount}</span>
                {personJourney.tableCount > 0 ? (
                  <span className="hud-status hud-status--running">相关表 {personJourney.tableCount}</span>
                ) : null}
                {personJourney.highlights.map((item) => (
                  <span key={item} className="hud-status hud-status--running">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {projects.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="hud-panel__label">{tableTitle("projects", "相关分组")}</div>
            <div className="hud-list" style={{ maxHeight: 170, overflow: "auto" }}>
              {projects.map((project) => {
                // 客户表里有什么就显示什么：字段缺失不显示（不补 0/undefined）
                const statusText = [project.status, project.progress]
                  .filter(Boolean)
                  .join(" · ");
                const meta = [
                  project.dueDate ? `截止 ${project.dueDate}` : "",
                  Number.isFinite(project.totalTasks) && project.totalTasks > 0
                    ? `事项 ${project.totalTasks}`
                    : "",
                  Number.isFinite(project.riskCount) && project.riskCount > 0
                    ? `风险 ${project.riskCount}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={project.id} className="hud-list__item">
                    <div className="hud-list__top">
                      <span>{project.priority || ""}</span>
                      <span>{statusText}</span>
                    </div>
                    <div className="hud-list__title">{project.name}</div>
                    {meta && (
                      <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5 }}>
                        {meta}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {milestones.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="hud-panel__label">{tableTitle("milestones", "相关进展")}</div>
            <div className="hud-list" style={{ maxHeight: 180, overflow: "auto" }}>
              {milestones.map((milestone) => (
                <div key={milestone.id} className="hud-list__item">
                  <div className="hud-list__top">
                    <span>{milestone.status}</span>
                    <span>{milestone.dueDate}</span>
                  </div>
                  <div className="hud-list__title">{milestone.name}</div>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5 }}>
                    {[milestone.projectName, `负责人 ${milestone.owner}`, milestone.deliverable]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="hud-panel__label">{tableTitle("tasks", "全部工作")}旅程</div>
        <div className="hud-panel__stack" style={{ gap: 8 }}>
          {groups.length === 0 ? (
            <div className="hud-empty">该成员当前没有相关任务。</div>
          ) : null}
          {groups.map((group) => (
            // 全部展开：已完成的历史记录也可见，不折叠
            <details key={group.key} open>
              <summary
                className="pixel-panel"
                style={{
                  cursor: "pointer",
                  padding: "8px 10px",
                  color: group.tone,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {group.title} ({group.tasks.length}) · {group.hint}
              </summary>
              <div className="hud-list" style={{ maxHeight: 260, overflow: "auto", marginTop: 6 }}>
                {group.tasks.map((task) => (
                  <div key={task.id} className="hud-list__item">
                    <div className="hud-list__top">
                      <span style={{ color: statusTone(task) }}>{task.status}</span>
                      <span>{task.remainingText || task.dueDate}</span>
                    </div>
                    <div className="hud-list__title">{task.title}</div>
                    {taskSummaryParts(task).length > 0 ? (
                      <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5 }}>
                        {taskSummaryParts(task).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>

        {allTableRecords.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="hud-panel__label">全部记录（所有表）</div>
            <div className="hud-panel__stack" style={{ gap: 8 }}>
              {allTableRecords.map((rec) => (
                <div key={`${rec.tableId}-${rec.recordId}`} className="pixel-panel" style={{ padding: 9, background: "rgba(255,255,255,0.04)" }}>
                  <div style={{ fontSize: 8, color: "var(--pixel-accent)", marginBottom: 5 }}>
                    {rec.tableTitle}
                  </div>
                  {/* 重点字段：一行展示（名称 · 状态 · 日期 · 人员） */}
                  <div style={{ fontSize: 9, lineHeight: 1.7 }}>
                    {rec.keyFields.map(([k, v]) => {
                      const text = fieldDisplayText(k, v);
                      if (!text.trim()) return null;
                      return (
                        <span key={k} style={{ marginRight: 8, color: "var(--pixel-text)" }}>
                          <span style={{ color: "var(--pixel-muted)" }}>{k}：</span>
                          <span style={{ wordBreak: "break-all" }}>{text}</span>
                        </span>
                      );
                    })}
                  </div>
                  {/* 其余字段：默认折叠，点开才显示（不堆砌） */}
                  {rec.otherFields.length > 0 && (
                    <details>
                      <summary style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5, cursor: "pointer" }}>
                        更多内容（{rec.otherFields.length}）
                      </summary>
                      <div style={{ marginTop: 5 }}>
                        {rec.otherFields.map(([k, v]) => {
                          const text = fieldDisplayText(k, v);
                          if (!text.trim()) return null;
                          // 长文本截断：超过 60 字显示前 60 字 + …
                          const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text;
                          return (
                            <div key={k} style={{ fontSize: 9, marginBottom: 3, display: "flex", gap: 6 }}>
                              <span style={{ color: "var(--pixel-muted)", flexShrink: 0 }}>{k}：</span>
                              <span style={{ wordBreak: "break-all" }}>{shown}</span>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <>
            <div className="hud-panel__label" style={{ marginTop: 14 }}>
              {tableTitle("risks", "相关风险")}
            </div>
            <div className="hud-list">
              {risks.map((risk) => (
                <div key={risk.id} className="hud-list__item">
                  <div className="hud-list__top">
                    <span>{risk.level}风险</span>
                    <span>{risk.status}</span>
                  </div>
                  <div className="hud-list__title">{risk.title}</div>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5 }}>
                    {risk.action || "未填写应对措施"} · 截止 {risk.dueDate || "未填写"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {firstAdjustTask ? (
          <button
            className="pixel-button pixel-button--primary w-full"
            style={{ marginTop: 14 }}
            onClick={() => {
              // 统一交给 ReassignModal 处理：未解锁先弹管理员验证，解锁后自动打开面板
              setSeatId(null);
              gameEvents.emit("open-reassign-panel", seat.seatId, firstAdjustTask.id);
            }}
          >
            建议调整负责人
          </button>
        ) : (
          <div className="seat-hint" style={{ marginTop: 8, borderColor: "var(--pixel-muted)", color: "var(--pixel-muted)", fontSize: 8 }}>
            {tasks.length === 0
              ? "该成员当前没有任务，无需调整负责人。"
              : "该成员没有超期/临期/进行中的任务，暂无调整建议。"}
          </div>
        )}
      </div>
    </div>
  );
}
