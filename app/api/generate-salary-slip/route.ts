import { NextRequest, NextResponse } from "next/server";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface SlipMetadata {
  month: string;
  year: string;
  sendMail: boolean;
  employeeIds: string[];
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    return jsonError("Server misconfiguration", 500);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonError("Expected multipart/form-data", 400);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const metadataRaw = formData.get("metadata");

  if (!(file instanceof Blob)) return jsonError("Missing file in request", 400);
  if (typeof metadataRaw !== "string")
    return jsonError("Missing metadata in request", 400);

  let metadata: SlipMetadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return jsonError("Invalid metadata JSON", 400);
  }

  const { month, year, sendMail, employeeIds } = metadata;
  if (!month || !year)
    return jsonError("month and year are required in metadata", 400);

  const fileBuffer = await file.arrayBuffer();
  if (fileBuffer.byteLength > MAX_FILE_SIZE) {
    return jsonError("File exceeds 5 MB limit", 413);
  }

  // Forward to webhook as multipart/form-data
  const webhookFormData = new FormData();
  webhookFormData.append(
    "file",
    new Blob([fileBuffer], { type: XLSX_MIME }),
    "salary.xlsx",
  );
  webhookFormData.append(
    "metaData",
    JSON.stringify({
      month,
      year,
      sendMail: !!sendMail,
      employeeIds: employeeIds ?? [],
    }),
  );

  const webhookResponse = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { SalarySlipGenerate: WEBHOOK_SECRET },
    body: webhookFormData,
  });

  if (!webhookResponse.ok) {
    return jsonError(`Webhook error: ${webhookResponse.status}`, 502);
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
