import { NextResponse } from "next/server";
import { createOfficeTask, type CreateOfficeTaskInput } from "@/lib/feishu-office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateOfficeTaskInput>;

    if (!body.title || !body.ownerName) {
      return NextResponse.json(
        { ok: false, message: "缺少事项标题或负责人。" },
        { status: 400 },
      );
    }

    const outcome = await createOfficeTask({
      title: body.title,
      ownerName: body.ownerName,
      projectId: body.projectId,
      status: body.status,
      description: body.description,
      type: body.type,
      priority: body.priority,
      importance: body.importance,
      stage: body.stage,
      startDate: body.startDate,
      dueDate: body.dueDate,
      remark: body.remark,
      fields: body.fields,
      extraFields: body.extraFields,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, message: outcome.error ?? "新增任务写回飞书失败。" },
        { status: 500 },
      );
    }

    if (!outcome.verified) {
      const failedFields = Array.isArray(outcome.readBack?.failedFields)
        ? outcome.readBack.failedFields.map(String).filter(Boolean)
        : [];
      return NextResponse.json(
        {
          ok: false,
          message: failedFields.length > 0
            ? `记录已创建，但以下字段未读回确认：${failedFields.join("、")}。请检查这些列是否为可写字段。`
            : "记录已创建但读回校验未通过，请刷新表格确认字段是否完整。",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      recordId: outcome.recordId,
      elapsedMs: outcome.elapsedMs,
      warnings: outcome.warnings ?? [],
      task: {
        id: outcome.recordId ?? `local-${Date.now()}`,
        title: body.title,
        owner: body.ownerName,
        status: "待办",
        priority: body.priority || "P3 低",
        type: body.type || "其他",
        dueDate: body.dueDate || "",
        remainingText: body.dueDate ? "待计算" : "",
        overdue: false,
        projectId: body.projectId,
        description: body.description || "",
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[office-live:create-task]", error);
    return NextResponse.json(
      { ok: false, message: "新增任务写回失败：请确认表格可编辑，且必填字段是可写字段。" },
      { status: 500 },
    );
  }
}
