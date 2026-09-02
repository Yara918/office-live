import { NextResponse } from "next/server";
import { fetchOfficeSnapshot } from "@/lib/feishu-office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const snapshot = await fetchOfficeSnapshot({ force });
  return NextResponse.json(snapshot);
}
