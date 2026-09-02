import { NextResponse } from "next/server";
import { reassignOfficeTask } from "@/lib/feishu-office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId?: string;
      ownerName?: string;
      reason?: string;
    };

    if (!body.taskId || !body.ownerName) {
      return NextResponse.json({ ok: false, message: "缺少任务或新负责人。" }, { status: 400 });
    }

    const outcome = await reassignOfficeTask(body.taskId, body.ownerName, body.reason);

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, message: outcome.error ?? "负责人写回飞书失败。" },
        { status: 500 },
      );
    }

    if (!outcome.verified) {
      return NextResponse.json(
        {
          ok: false,
          message: `写回已提交但读回校验未通过（读回负责人为「${outcome.readBack?.owner ?? outcome.readBack?.ownerId ?? "未知"}」），请刷新确认。`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      taskId: body.taskId,
      ownerName: body.ownerName,
      elapsedMs: outcome.elapsedMs,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[office-live:reassign]", error);
    return NextResponse.json(
      { ok: false, message: "负责人写回失败：请确认表格可编辑，且负责人列是可写文本、人员或关联字段。" },
      { status: 500 },
    );
  }
}
