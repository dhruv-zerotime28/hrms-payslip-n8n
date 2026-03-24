import { NextRequest, NextResponse } from "next/server";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) &&
    !contentType.includes("application/vnd.ms-excel")
  ) {
    return NextResponse.json(
      { error: "Only Excel files (.xlsx / .xls) are accepted" },
      { status: 400 },
    );
  }

  const body = await request.arrayBuffer();

  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
  if (body.byteLength > MAX_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 5 MB limit" },
      { status: 413 },
    );
  }

  const webhookResponse = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      SalarySlipGenerate: WEBHOOK_SECRET,
      "Content-Type": contentType,
    },
    body: body,
  });

  if (!webhookResponse.ok) {
    return NextResponse.json(
      { error: `Webhook error: ${webhookResponse.status}` },
      { status: 502 },
    );
  }

  const zipBuffer = await webhookResponse.arrayBuffer();

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="salary-slips.zip"',
    },
  });
}
