"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import { fieldValueText, isTaskDone, isTaskDueSoon, isTaskRunning, taskOwnedBy, type OfficeTask } from "@/lib/office-data";
import { useOfficeData } from "@/lib/office-sync";
import { fieldsOf, tableTitle } from "@/lib/office-config";
import { emitOperationLog, useOperationLog } from "@/lib/operation-log";

const CUSTOM_TASK_ID = "__custom__";

function taskWeight(task: OfficeTask) {
  if (task.overdue) return 0;
  if (isTaskDueSoon(task)) return 1;
  if (isTaskRunning(task)) return 2;
  return 3;
}

function taskOptionLabel(task: OfficeTask) {
  const timing = task.overdue ? "超期" : task.remainingText || task.status;
  const subject = [task.projectName, task.title].filter(Boolean).join(" · ");
  const owner = task.owner ? ` · ${task.owner}` : "";
  return [timing, subject || task.title].filter(Boolean).join(" · ") + owner;
}

function readonlyFieldReason(ft: number, isLinkWithoutOptions: boolean) {
  if (isLinkWithoutOptions) return "关联目标未读取到，暂不能在页面手填。";
  if (ft === 7) return "人员字段需要飞书用户身份，当前列只展示不手填。";
  if (ft === 90 || ft === 11 || ft === 15 || ft === 17 || ft === 18 || ft === 20) {
    return "此字段由飞书自动生成或计算，不能手动写入。";
  }
  return "";
}

const WRITABLE_PRIMARY_TYPES = new Set([2, 3, 4, 5, 21]);

export default function TerminalModal() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [targetMemberName, setTargetMemberName] = useState<string | undefined>(undefined);
  const [sourceTaskId, setSourceTaskId] = useState(CUSTOM_TASK_ID);
  // 通用字段值：key = 客户表语义位（name/owner/status/due/type/priority...），value = 表单输入
  // 完全由 fieldsOf("tasks") 驱动，客户表有什么字段就存什么、显示什么，无固定默认值
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const elapsedTimer = useRef<number | null>(null);
  const { state, assignTask, prepareSessionForSeat } = useStudio();
  const { snapshot, createTask, reassignTask, isAdmin, activeMembers } = useOfficeData();
  const { updateLog } = useOperationLog();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const candidateMembers = useMemo(() => snapshot.members, [snapshot.members]);

  // 客户表字段：有哪些语义位就渲染哪些输入（有哪个显示哪个，绝不出现项目管理残留）
  const taskFields = fieldsOf("tasks");
  const has = (semantic: string) => Boolean(taskFields[semantic]);
  const tableName = tableTitle("tasks", "事项");
  const setField = (semantic: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [semantic]: value }));

  // 通用化：客户表 tasks 的【所有字段】（fieldKinds）——新建表单 = 每个字段一个输入框（填单元格）
  // name 字段 = 主输入框；person 字段 = 选人；其余字段按 kind 生成 text/date/number 输入
  const tasksTable = useMemo(
    () => snapshot.tables.find((t) => t.role === "tasks") ?? snapshot.tables[0],
    [snapshot.tables],
  );
  const taskFieldList = useMemo(() => {
    if (!tasksTable) return [];
    const nameField = Object.entries(tasksTable.fieldKinds).find(([, k]) => k === "name")?.[0];
    const nameFieldType = nameField ? tasksTable.fieldTypes?.[nameField] ?? 1 : 1;
    const nameUsesTextInput = !!nameField && !WRITABLE_PRIMARY_TYPES.has(nameFieldType);
    // 全部字段（真实字段名 + 语义 kind），只排除已有专用控件的列；非文本事项名也必须进字段控件。
    const separatelyRendered = new Set([
      nameUsesTextInput ? nameField : undefined,
      taskFields.owner,
    ].filter(Boolean));
    return Object.entries(tasksTable.fieldKinds)
      .filter(([fname]) => !separatelyRendered.has(fname))
      .map(([fname, kind]) => ({ fname, kind }));
  }, [taskFields.owner, tasksTable]);
  const tasksNameField = useMemo(
    () => (tasksTable ? Object.entries(tasksTable.fieldKinds).find(([, k]) => k === "name")?.[0] : undefined),
    [tasksTable],
  );
  // select 字段选项：直接用飞书字段真实选项（fieldOptions），不靠记录猜
  const selectOptionsFor = (fname: string) => tasksTable?.fieldOptions?.[fname] ?? [];
  // 字段真实类型（1=Text 2=Number 3=Single 4=Multi 5=Date 21=Link 7=人员）与百分比/关联信息
  const fieldTypeOf = (fname: string) => tasksTable?.fieldTypes?.[fname] ?? 1;
  const nameFieldUsesTextInput = useMemo(() => {
    if (!tasksTable || !tasksNameField) return true;
    return !WRITABLE_PRIMARY_TYPES.has(fieldTypeOf(tasksNameField));
  }, [tasksNameField, tasksTable]);
  const isPercentField = (fname: string) => (tasksTable?.fieldPercents ?? []).includes(fname);
  const linkTargetOf = (fname: string) => tasksTable?.fieldLinks?.[fname];
  // 多选字段当前值（字符串数组）
  const multiValues = (fname: string): string[] => {
    const v = fieldValues[fname];
    if (Array.isArray(v)) return v;
    if (!v) return [];
    return String(v).split(/[,，、;；\s]+/).filter(Boolean);
  };
  const toggleMulti = (fname: string, opt: string) => {
    const cur = multiValues(fname);
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    setField(fname, next.join("、"));
  };
  // 关联字段可选项：目标表记录（用目标表记录的第一个字段做显示名，值=recordId）
  const linkOptionsFor = (fname: string): Array<{ id: string; label: string }> => {
    const target = linkTargetOf(fname);
    if (!target) return [];
    const targetTable = snapshot.tables.find((t) => t.id === target.tableId);
    if (!targetTable) return [];
    const nameField =
      Object.entries(targetTable.fieldKinds).find(([, k]) => k === "name")?.[0] ??
      Object.keys(targetTable.records[0]?.fields ?? {})[0] ??
      "";
    return targetTable.records.map((r) => ({
      id: r.id,
      label: nameField ? fieldValueText(r.fields[nameField]) || `已关联 ${r.id}` : `已关联 ${r.id}`,
    }));
  };
  const displaySubmittedField = (fname: string | undefined, value: unknown) => {
    if (!fname) return fieldValueText(value);
    if (fieldTypeOf(fname) === 21) {
      const id = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
      const label = linkOptionsFor(fname).find((opt) => opt.id === id)?.label;
      if (label) return label;
    }
    return fieldValueText(value);
  };

  const stopTimer = () => {
    if (elapsedTimer.current != null) {
      window.clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
    setElapsed(0);
    setSlowHint(false);
  };

  const tableTasks = useMemo(
    () =>
      snapshot.tasks
        .slice()
        .sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)) || taskWeight(a) - taskWeight(b)),
    [snapshot.tasks],
  );
  const selectedTask = tableTasks.find((task) => task.id === sourceTaskId);

  const resetForm = useCallback(() => {
    setSourceTaskId(CUSTOM_TASK_ID);
    setFieldValues({});
    setInput("");
    setNotice(null);
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTargetMemberName(undefined);
    resetForm();
    gameEvents.emit("terminal-closed");
  }, [resetForm]);

  useEffect(() => {
    const handleOpen = async (seatId?: string) => {
      // 双保险：未解锁管理权限时，任务面板不开（点 E 已校验，此处防其他入口）
      if (!isAdmin) {
        gameEvents.emit("request-admin");
        return;
      }
      if (seatId) await prepareSessionForSeat(seatId);
      const seat = state.seats.find((item) => item.seatId === seatId);
      setTargetMemberName(seat?.label);
      resetForm();
      setOpen(true);
    };
    const unsubOpen = gameEvents.on("open-terminal", (seatId) => {
      void handleOpen(seatId);
    });
    const unsubQueue = gameEvents.on("open-terminal-queue", (seatId) => {
      void handleOpen(seatId);
    });
    return () => {
      unsubOpen();
      unsubQueue();
    };
  }, [isAdmin, prepareSessionForSeat, resetForm, state.seats]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, close]);

  const handleTaskChange = (taskId: string) => {
    setSourceTaskId(taskId);
    setNotice(null);
    const task = tableTasks.find((item) => item.id === taskId);
    if (task) {
      // 已有任务：默认保留原负责人座位，可改选新的对接人；调整说明可选
      setInput("");
      const ownerMember = candidateMembers.find((member) => taskOwnedBy(task, member.name));
      if (ownerMember) setTargetMemberName(ownerMember.name);
    } else {
      setInput("");
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const targetMember = candidateMembers.find((member) => member.name === targetMemberName);
    const targetSeat = state.seats.find((seat) => seat.label === targetMember?.name);
    if (!targetMember?.name) {
      setNotice({ tone: "error", text: "请先选择要安排给哪位成员。" });
      return;
    }
    const trimmed = input.trim();

    if (sourceTaskId === CUSTOM_TASK_ID) {
      const submittedFields: Record<string, unknown> = Object.fromEntries(
        taskFieldList
          .map((f) => [f.fname, fieldValues[f.fname] ?? ""])
          .filter(([, v]) => {
            if (Array.isArray(v)) return v.length > 0;
            return String(v).trim() !== "";
          }),
      );
      if (nameFieldUsesTextInput && tasksNameField && trimmed) submittedFields[tasksNameField] = trimmed;
      const hasNameValue = tasksNameField ? String(submittedFields[tasksNameField] ?? "").trim() !== "" : !!trimmed;
      if (!hasNameValue) {
        setNotice({ tone: "error", text: `请填写${tasksNameField ?? tableTitle("tasks", "事项")}。` });
        return;
      }
      const titleForLog = trimmed || displaySubmittedField(tasksNameField, submittedFields[tasksNameField ?? ""]) || tableName;
      setSubmitting(true);
      setNotice(null);
      const startedAt = Date.now();
      // 提交即记录：右下角立刻可见"正在写回飞书…"，关掉弹窗也能追踪
      const logId = emitOperationLog(
        `正在写回飞书：新增任务「${titleForLog}」给 ${targetMember.name}…`,
        "pending",
      );
      elapsedTimer.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        if (Date.now() - startedAt > 15_000) setSlowHint(true);
      }, 1000);
      const result = await createTask({
        title: titleForLog,
        ownerName: targetMember.name,
        projectId: has("project") ? fieldValues[taskFields.project] ?? "" : "",
        description: has("description") ? fieldValues[taskFields.description] ?? "" : "",
        type: has("type") ? fieldValues["type"] ?? "" : "",
        priority: has("priority") ? fieldValues["priority"] ?? "" : "",
        importance: has("importance") ? fieldValues["importance"] ?? "" : "",
        stage: has("stage") ? fieldValues["stage"] ?? "" : "",
        // 日期字段用【真实字段名】取值（fieldValues 的 key 是客户表字段名，不是语义位）
        startDate: has("start") ? fieldValues[taskFields.start] ?? "" : "",
        dueDate: has("due") ? fieldValues[taskFields.due] ?? "" : "",
        remark: "由 Office Live 小剧场新增",
        fields: submittedFields,
        status: fieldValues[taskFields.status] || "",
      });
      stopTimer();
      setSubmitting(false);
      if (!result.ok) {
        const text = result.error || "新增任务写回飞书失败，请稍后重试。";
        setNotice({ tone: "error", text });
        updateLog(logId, `新增任务失败：「${titleForLog}」未能写回飞书。${text}`, "error");
        return;
      }
      setNotice({
        tone: "ok",
        text: `已写回飞书，并已读回确认（耗时 ${(result.elapsedMs ?? 0) / 1000} 秒）。`,
      });
      updateLog(logId, `${targetMember.name} 新增任务「${titleForLog}」，已同步飞书。`, "ok");
      if (targetSeat) assignTask(`新增任务：${titleForLog}`, targetSeat.seatId);
      window.setTimeout(close, 1200);
      return;
    }

    if (selectedTask) {
      // 已有任务：换对接人，真实写回飞书 + 读回校验
      setSubmitting(true);
      setNotice(null);
      const startedAt = Date.now();
      const logId = emitOperationLog(
        `正在写回飞书：将「${selectedTask.title}」对接人调整为 ${targetMember.name}…`,
        "pending",
      );
      elapsedTimer.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        if (Date.now() - startedAt > 15_000) setSlowHint(true);
      }, 1000);
      const result = await reassignTask(
        selectedTask.id,
        targetMember.name,
        "由任务台调整对接人",
      );
      stopTimer();
      setSubmitting(false);
      if (!result.ok) {
        const text = result.error || "对接人写回飞书失败，请稍后重试。";
        setNotice({ tone: "error", text });
        updateLog(logId, `调整对接人失败：「${selectedTask.title}」未能写回飞书。${text}`, "error");
        return;
      }
      setNotice({
        tone: "ok",
        text: `已写回飞书，并已读回确认（耗时 ${(result.elapsedMs ?? 0) / 1000} 秒）。`,
      });
      updateLog(
        logId,
        `${selectedTask.title} 对接人调整为 ${targetMember.name}，已同步飞书。`,
        "ok",
      );
      if (targetSeat) assignTask(`接手任务：${selectedTask.title}`, targetSeat.seatId);
      window.setTimeout(close, 1200);
      return;
    }
  };

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: "rgba(0,0,0,0.6)", pointerEvents: "auto" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="pixel-panel" style={{ width: "min(720px, 94vw)", maxHeight: "88vh", overflow: "auto", padding: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14 }}>任务台</div>
            <div style={{ fontSize: 9, color: "var(--pixel-muted)", marginTop: 4 }}>
              所有操作实时写回飞书：新建{tableName}按表格内容写入；选择已有{tableName}可调整负责人。
            </div>
          </div>
          <button className="pixel-button" style={{ fontSize: 8, padding: "2px 8px" }} onClick={close}>
            关闭
          </button>
        </div>

        <div className="hud-panel__stack" style={{ gap: 10 }}>
          <div>
            <label className="hud-panel__label">事项来源</label>
            <select className="pixel-input hud-panel__input" value={sourceTaskId} onChange={(event) => handleTaskChange(event.target.value)}>
              <option value={CUSTOM_TASK_ID}>新建{tableName}</option>
              {tableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {taskOptionLabel(task)}
                </option>
              ))}
            </select>
          </div>

          {sourceTaskId === CUSTOM_TASK_ID && (
            <>
              {/* 项目/分组：有分组表且有该字段才显示（下拉选分组） */}
              {has("project") && snapshot.projects.length > 0 && (
                <div>
                  <label className="hud-panel__label">{taskFields.project}</label>
                  <select
                    className="pixel-input hud-panel__input"
                    value={fieldValues[taskFields.project] ?? ""}
                    onChange={(event) => setField(taskFields.project, event.target.value)}
                  >
                    <option value="">未选择</option>
                    {snapshot.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                        {project.status ? ` · ${project.status}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* 通用字段表单：客户表【所有字段】都渲染输入框（填单元格），无固定预设 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {taskFieldList.map(({ fname, kind }) => {
                  const ft = fieldTypeOf(fname);
                  const isDate = kind === "date" || ft === 5;
                  const isNumber = kind === "number" || ft === 2;
                  const isPercent = isNumber && isPercentField(fname);
                  const isMulti = ft === 4;
                  const isLink = ft === 21;
                  const linkOpts = isLink ? linkOptionsFor(fname) : [];
                  const readonlyReason = readonlyFieldReason(ft, isLink && linkOpts.length === 0);
                  if (readonlyReason) {
                    return (
                      <label key={fname}>
                        <span className="hud-panel__label">{fname}</span>
                        <input
                          className="pixel-input hud-panel__input"
                          value={readonlyReason}
                          disabled
                          readOnly
                          style={{ opacity: 0.72, cursor: "not-allowed" }}
                        />
                      </label>
                    );
                  }
                  // 只有飞书真实选项字段且拿到选项时才渲染下拉；文本型状态/负责人等语义字段用普通输入，避免空下拉。
                  const selectOptions = isMulti ? [] : selectOptionsFor(fname);
                  const isSelect = ft === 3 && selectOptions.length > 0 && !isMulti;
                  const value = fieldValues[fname] ?? "";
                  if (isMulti) {
                    const picked = multiValues(fname);
                    const multiOptions = selectOptionsFor(fname);
                    if (multiOptions.length === 0) {
                      return (
                        <label key={fname} style={{ gridColumn: "span 1" }}>
                          <span className="hud-panel__label">{fname}</span>
                          <input
                            className="pixel-input hud-panel__input"
                            type="text"
                            placeholder="多个值用顿号分隔"
                            value={value}
                            onChange={(event) => setField(fname, event.target.value)}
                          />
                        </label>
                      );
                    }
                    return (
                      <label key={fname} style={{ gridColumn: "span 1" }}>
                        <span className="hud-panel__label">{fname}（可多选）</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                          {multiOptions.map((opt) => (
                            <label
                              key={opt}
                              className="pixel-input"
                              style={{
                                fontSize: 8,
                                padding: "2px 6px",
                                cursor: "pointer",
                                background: picked.includes(opt) ? "rgba(80,180,120,0.25)" : "rgba(255,255,255,0.06)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={picked.includes(opt)}
                                onChange={() => toggleMulti(fname, opt)}
                                style={{ accentColor: "var(--pixel-green)" }}
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </label>
                    );
                  }
                  if (isLink) {
                    return (
                      <label key={fname}>
                        <span className="hud-panel__label">{fname}</span>
                        <select
                          className="pixel-input hud-panel__input"
                          value={value}
                          onChange={(event) => setField(fname, event.target.value)}
                        >
                          <option value="">未选择</option>
                          {linkOpts.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label key={fname}>
                      <span className="hud-panel__label">
                        {fname}
                        {isPercent ? "（%）" : ""}
                      </span>
                      {isSelect ? (
                        <select
                          className="pixel-input hud-panel__input"
                          value={value}
                          onChange={(event) => setField(fname, event.target.value)}
                        >
                          <option value="">未选择</option>
                          {selectOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="pixel-input hud-panel__input"
                          type={isDate ? "date" : isNumber ? "number" : "text"}
                          min={isNumber && !isPercent ? undefined : 0}
                          max={isPercent ? 100 : undefined}
                          step={isPercent ? 1 : undefined}
                          placeholder={isPercent ? "填 0-100，如 60" : undefined}
                          value={value}
                          onChange={(event) => setField(fname, event.target.value)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {sourceTaskId !== CUSTOM_TASK_ID && selectedTask && (
            <div
              className="pixel-panel"
              style={{ padding: 9, background: "rgba(255,255,255,0.04)", fontSize: 9 }}
            >
              当前任务：{selectedTask.title} · 项目：{selectedTask.projectName ?? "未识别"} · 当前负责人：
              {selectedTask.owner} · {selectedTask.status}
              {selectedTask.overdue ? "（超期）" : ""}
              <div style={{ marginTop: 4, color: "var(--pixel-accent)" }}>
                选择下方成员后确认，将把该任务对接人写回飞书。
              </div>
            </div>
          )}

          <div>
            <label className="hud-panel__label">
              {sourceTaskId === CUSTOM_TASK_ID ? "安排给" : "对接人调整为"}
            </label>
            <select className="pixel-input hud-panel__input" value={targetMemberName ?? ""} onChange={(event) => setTargetMemberName(event.target.value || undefined)}>
              <option value="">
                {sourceTaskId === CUSTOM_TASK_ID ? "请选择成员" : "请选择新对接人"}
              </option>
              {candidateMembers
                .map((member) => (
                  <option key={member.id} value={member.name}>
                    {member.role && member.role !== "成员" ? `${member.name}（${member.role}）` : member.name}
                  </option>
                ))}
            </select>
          </div>

          {(sourceTaskId !== CUSTOM_TASK_ID || nameFieldUsesTextInput) && (
            <textarea
              ref={inputRef}
              className="pixel-input"
              placeholder={sourceTaskId === CUSTOM_TASK_ID ? `输入${tasksNameField ?? tableName}` : "调整说明（可选）"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              style={{ minHeight: 58 }}
            />
          )}

          {notice && (
            <div
              className="seat-hint"
              style={{
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
              style={{ borderColor: "var(--pixel-yellow)", color: "var(--pixel-yellow)" }}
            >
              飞书仍在处理，请继续等待，不要重复提交。
            </div>
          )}

          <button
            className="pixel-button pixel-button--primary w-full"
            onClick={() => void handleSubmit()}
            disabled={
              submitting ||
              !targetMemberName ||
              (sourceTaskId === CUSTOM_TASK_ID &&
                !(nameFieldUsesTextInput ? input.trim() : String(fieldValues[tasksNameField ?? ""] ?? "").trim()))
            }
          >
            {submitting
              ? `正在写回飞书...（${elapsed} 秒）`
              : sourceTaskId === CUSTOM_TASK_ID
                ? "确认新增并写回飞书"
                : "确认调整对接人并写回飞书"}
          </button>
        </div>
      </div>
    </div>
  );
}
