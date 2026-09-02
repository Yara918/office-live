"use client";

import { useMemo } from "react";
import { fieldValueText } from "@/lib/office-data";
import { useOfficeData } from "@/lib/office-sync";
import { tableTitle } from "@/lib/office-config";
import HudFlyout from "./HudFlyout";

/** 通用化任务中心：所有有"人员字段"的客户表都列出，按表分组展示 */
export default function TaskPanel() {
  const { snapshot } = useOfficeData();
  const tasksTitle = tableTitle("tasks", "事项");
  const analysis = snapshot.analysis;
  const subjectMap = analysis?.subjectMap;
  const mainTable = useMemo(() => {
    if (!subjectMap) return snapshot.tables.find((t) => t.role === "tasks") ?? snapshot.tables[0];
    return snapshot.tables.find((t) => t.title === subjectMap.mainTable) ?? snapshot.tables.find((t) => t.role === "tasks") ?? snapshot.tables[0];
  }, [snapshot.tables, subjectMap]);

  const mainRecords = useMemo(() => {
    if (!mainTable) return [];
    const fieldScore = (field: string) => {
      if (field === subjectMap?.workItem) return 0;
      const kind = mainTable.fieldKinds[field];
      if (kind === "person") return 1;
      if (kind === "status") return 2;
      if (kind === "date") return 3;
      if (kind === "number" || kind === "group") return 4;
      if (kind === "name") return 5;
      if (kind === "link") return 20;
      return 10;
    };
    const preferred = [
      subjectMap?.workItem,
      ...(subjectMap?.businessSubjects ?? []),
      ...(subjectMap?.people ?? []),
      ...(subjectMap?.statusFields ?? []),
      ...(subjectMap?.valueFields ?? []),
      ...(subjectMap?.timeFields ?? []),
      ...(subjectMap?.relationFields ?? []),
    ].filter((field): field is string => Boolean(field));
    return mainTable.records.map((record) => {
      const fields = [...new Set([...preferred, ...Object.keys(record.fields)])]
        .filter((field) => fieldValueText(record.fields[field]).trim())
        .map((field) => ({ field, value: fieldValueText(record.fields[field]), kind: mainTable.fieldKinds[field] }));
      const titleField =
        subjectMap?.workItem ??
        fields.find((item) => item.kind === "name")?.field ??
        fields.find((item) => item.kind !== "link")?.field;
      const title = titleField ? fieldValueText(record.fields[titleField]).trim() : "";
      const visible = fields
        .filter((item) => item.field !== titleField && item.kind !== "link")
        .sort((a, b) => fieldScore(a.field) - fieldScore(b.field))
        .slice(0, 3);
      const visibleKeys = new Set([titleField, ...visible.map((item) => item.field)].filter(Boolean));
      return {
        id: record.id,
        title: title || "未命名记录",
        visible,
        hidden: fields.filter((item) => !visibleKeys.has(item.field)),
      };
    });
  }, [mainTable, subjectMap]);

  // 其他表：有人员字段的客户表，按表分组（表名 + 未完成记录）
  const otherTables = useMemo(() => {
    return snapshot.tables
      .filter((t) => t.role !== "tasks")
      .map((t) => {
        const personFields = Object.entries(t.fieldKinds)
          .filter(([, k]) => k === "person")
          .map(([name]) => name);
        const statusField = Object.entries(t.fieldKinds).find(([, k]) => k === "status")?.[0];
        const nameField = Object.entries(t.fieldKinds).find(([, k]) => k === "name")?.[0];
        const dateFields = Object.entries(t.fieldKinds)
          .filter(([, k]) => k === "date")
          .map(([name]) => name);
        if (personFields.length === 0 && nameField) {
          // 没有人员字段但有名称字段：也展示（如门店档案）
          return {
            title: t.title,
            hasDate: dateFields.length > 0,
            records: t.records.map((rec) => ({
              id: rec.id,
              title: fieldValueText(rec.fields[nameField]) || "未命名",
              status: statusField ? fieldValueText(rec.fields[statusField]) : "",
              person: "",
              date: dateFields[0] ? fieldValueText(rec.fields[dateFields[0]]) : "",
            })),
          };
        }
        if (personFields.length === 0) return null;
        return {
          title: t.title,
          hasDate: dateFields.length > 0,
          records: t.records.map((rec) => ({
            id: rec.id,
            title: nameField ? fieldValueText(rec.fields[nameField]) || "未命名" : "未命名",
            status: statusField ? fieldValueText(rec.fields[statusField]) : "",
            person: personFields.map((pf) => fieldValueText(rec.fields[pf])).filter(Boolean).join("、"),
            date: dateFields[0] ? fieldValueText(rec.fields[dateFields[0]]) : "",
          })),
        };
      })
      .filter((t): t is { title: string; hasDate: boolean; records: { id: string; title: string; status: string; person: string; date: string }[] } => t !== null);
  }, [snapshot.tables]);

  return (
    <HudFlyout
      title={`${tasksTitle}中心`}
      subtitle={mainTable?.title ?? "主入口表"}
    >
      <div className="hud-list">
        {mainRecords.length === 0 ? (
          <div className="hud-empty">表格中暂无事项。</div>
        ) : (
          mainRecords.map((record) => (
            <div key={record.id} className="hud-list__item">
              <div className="hud-list__top">
                <span className="hud-status hud-status--empty">{mainTable?.title ?? "主入口表"}</span>
                <span>{record.visible.slice(0, 2).map((item) => item.value).filter(Boolean).join(" · ")}</span>
              </div>
              <div className="hud-list__title">{record.title}</div>
              {record.visible.length > 0 && (
                <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 5, lineHeight: 1.6 }}>
                  {record.visible.map((item) => `${item.field}：${item.value}`).join(" · ")}
                </div>
              )}
              {record.hidden.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontSize: 8, color: "var(--pixel-muted)" }}>
                    更多内容（{record.hidden.length}）
                  </summary>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4, lineHeight: 1.6 }}>
                    {record.hidden.map((item) => `${item.field}：${item.value}`).join(" · ")}
                  </div>
                </details>
              )}
            </div>
          ))
        )}
      </div>

      {otherTables.map((t) => (
        <div key={t.title} style={{ marginTop: 12 }}>
          <div className="hud-panel__label">{t.title}</div>
          <div className="hud-list">
            {t.records.length === 0 ? (
              <div className="hud-empty">暂无记录。</div>
            ) : (
              t.records.map((rec) => (
                <div key={rec.id} className="hud-list__item">
                  <div className="hud-list__top">
                    <span className={`hud-status ${rec.status ? "hud-status--empty" : ""}`}>
                      {rec.status}
                    </span>
                    {/* 表里有日期列才显示日期位；没有日期就不占位。 */}
                    {(rec.person || t.hasDate) && (
                      <span>
                        {rec.person ? `${rec.person} · ` : ""}
                        {t.hasDate ? rec.date : ""}
                      </span>
                    )}
                  </div>
                  <div className="hud-list__title">{rec.title}</div>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </HudFlyout>
  );
}
