"use client";

import {
  useState,
  useRef,
  useCallback,
  type DragEvent,
  type ChangeEvent,
} from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

const REQUIRED_COLUMNS = [
  "No.",
  "Sr. No.",
  "NAME",
  "FATHER'S NAME",
  "DESIGNATION",
  "STAFF/WORKER",
  "DOB",
  "D.O.J.",
  "BASIC+DA",
  "HRA",
  "LTA",
  "ALLOWANCE",
  "GROSS TOTAL",
  "Payable Days",
  "T.Days",
  "Basic+DA(calc)",
  "HRA(calc)",
  "LTA(calc)",
  "Allowance(calc)",
  "Reb. (OT/ Pending/PL)",
  "Gross",
  "Retention Bonus",
  "PT",
  "TDS",
  "Total  Payble",
  "Branch",
  "Bank A/c No.",
  "IFSC CODE",
];

const SALARY_SHEET_KEYWORDS = ["salary", "sal", "payroll", "wages"];
const MAX_FILE_SIZE_MB = 5;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function extractMonthYear(filename: string): { month: string; year: string } {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ");
  let month = "";
  let year = "";
  for (const m of MONTHS) {
    if (base.toLowerCase().includes(m.toLowerCase())) {
      month = m;
      break;
    }
    const short = m.slice(0, 3);
    // match short month as a whole word
    const shortRe = new RegExp(`\\b${short}\\b`, "i");
    if (shortRe.test(base)) {
      month = m;
      break;
    }
  }
  const yearMatch = base.match(/\b(20\d{2})\b/);
  if (yearMatch) year = yearMatch[1];
  return { month, year };
}

type SheetRow = Record<string, string | number | undefined>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}

function normalizeCol(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export default function SalarySlipForm() {
  const [file, setFile] = useState<File | null>(null);
  const [, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetData, setSheetData] = useState<SheetRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [success, setSuccess] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [monthAutoDetected, setMonthAutoDetected] = useState(false);
  const [yearAutoDetected, setYearAutoDetected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Validation ─────────────────────────────────────── */

  const validateSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const validationErrors: string[] = [];
    const worksheet = wb.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<SheetRow>(worksheet);

    if (jsonData.length === 0) {
      validationErrors.push(`Sheet "${sheetName}" has no data rows.`);
      setSheetData([]);
      setColumns([]);
      setErrors(validationErrors);
      return;
    }

    const fileColumns = Object.keys(jsonData[0]);
    setColumns(fileColumns);

    const missingCols = REQUIRED_COLUMNS.filter(
      (col) =>
        !fileColumns.some((fc) => normalizeCol(fc) === normalizeCol(col)),
    );
    if (missingCols.length > 0) {
      validationErrors.push(
        `Missing required columns: ${missingCols.join(", ")}`,
      );
    }

    const emptyFieldRows: string[] = [];
    jsonData.forEach((row, idx) => {
      REQUIRED_COLUMNS.forEach((col) => {
        const matchedKey = fileColumns.find(
          (fc) => normalizeCol(fc) === normalizeCol(col),
        );
        if (
          matchedKey &&
          (row[matchedKey] === undefined || row[matchedKey] === "")
        ) {
          emptyFieldRows.push(`Row ${idx + 2}: "${col}" is empty`);
        }
      });
    });
    if (emptyFieldRows.length > 0) {
      validationErrors.push(...emptyFieldRows.slice(0, 10));
      if (emptyFieldRows.length > 10) {
        validationErrors.push(
          `...and ${emptyFieldRows.length - 10} more empty field issues`,
        );
      }
    }

    setSheetData(jsonData.slice(0, 5));
    setErrors(validationErrors);
  }, []);

  const validateAndParseFile = useCallback(
    (selectedFile: File) => {
      setErrors([]);
      setSheetData([]);
      setColumns([]);
      setSuccess("");
      setWorkbook(null);
      setSheetNames([]);

      const validationErrors: string[] = [];

      const ext = selectedFile.name.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xls") {
        validationErrors.push(
          "Invalid file type. Only .xlsx and .xls files are accepted.",
        );
        setErrors(validationErrors);
        return;
      }

      if (selectedFile.size > MAX_FILE_SIZE_MB * 1048576) {
        validationErrors.push(
          `File size exceeds ${MAX_FILE_SIZE_MB} MB limit.`,
        );
        setErrors(validationErrors);
        return;
      }

      setFile(selectedFile);

      // Try to extract month & year from filename
      const { month: extractedMonth, year: extractedYear } = extractMonthYear(
        selectedFile.name,
      );
      if (extractedMonth) {
        setMonth(extractedMonth);
        setMonthAutoDetected(true);
      } else {
        setMonth("");
        setMonthAutoDetected(false);
      }
      if (extractedYear) {
        setYear(extractedYear);
        setYearAutoDetected(true);
      } else {
        setYear("");
        setYearAutoDetected(false);
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          setWorkbook(wb);
          setSheetNames(wb.SheetNames);

          const salarySheet = wb.SheetNames.find((name) =>
            SALARY_SHEET_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)),
          );
          const autoSheet = salarySheet || wb.SheetNames[0];
          validateSheet(wb, autoSheet);
        } catch {
          setErrors([
            "Failed to parse the Excel file. Please ensure it is a valid .xlsx/.xls file.",
          ]);
          setFile(null);
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    },
    [validateSheet],
  );

  /* ── Drag / file handlers ───────────────────────────── */

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) validateAndParseFile(droppedFile);
    },
    [validateAndParseFile],
  );

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) validateAndParseFile(selected);
      e.target.value = "";
    },
    [validateAndParseFile],
  );

  const removeFile = useCallback(() => {
    setFile(null);
    setWorkbook(null);
    setSheetNames([]);
    setSheetData([]);
    setColumns([]);
    setErrors([]);
    setSuccess("");
    setProgress("");
    setMonth("");
    setYear("");
    setMonthAutoDetected(false);
    setYearAutoDetected(false);
  }, []);

  /* ── Submit (calls our own API route, NOT the webhook) ─ */

  const handleSubmit = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    setErrors([]);
    setSuccess("");
    setProgress("Sending to server...");

    try {
      const params = new URLSearchParams({ month, year });
      const response = await fetch(
        `/api/generate-salary-slip?${params.toString()}`,
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Server error: ${response.status}`);
      }

      setProgress("Downloading ZIP...");
      const zipBlob = await response.blob();
      saveAs(zipBlob, "salary-slips.zip");

      setSuccess("Salary slips generated and downloaded!");

      setFile(null);
      setWorkbook(null);
      setSheetNames([]);
      setSheetData([]);
      setColumns([]);
      setMonth("");
      setYear("");
      setMonthAutoDetected(false);
      setYearAutoDetected(false);
    } catch (err) {
      console.error(err);
      setErrors([
        err instanceof Error
          ? err.message
          : "Failed to generate salary slips. Please try again.",
      ]);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [file, month, year]);

  const canSubmit = file && errors.length === 0 && !loading && month && year;

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-180 px-6 py-12 max-md:px-4 max-md:py-8 max-sm:px-3 max-sm:py-6">
      {/* Header */}
      <header className="mb-10 max-md:mb-7 text-center">
        <h1 className="text-5xl font-bold text-accent mb-10 max-md:text-[28px] max-md:mb-6 max-sm:text-[22px] max-sm:mb-4">
          ZEROTIME SOLUTIONS
        </h1>
        <h2 className="text-[32px] font-bold text-text-h mb-2 max-md:text-[22px] max-sm:text-lg ">
          Salary Slip Generator
        </h2>
        <p className="text-[15px] text-text max-md:text-sm">
          Upload employee salary data to generate PDF salary slips
        </p>
      </header>

      {/* Drop zone */}
      <div
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 px-6 text-center transition-all duration-200 max-md:py-8 max-md:px-4 max-sm:py-6 max-sm:px-3 max-sm:rounded-lg ${
          dragging
            ? "border-accent bg-accent-bg scale-[1.01]"
            : file
              ? "border-accent border-solid"
              : "border-border bg-white hover:border-accent-border hover:bg-accent-bg"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileSelect}
        />
        {!file ? (
          <>
            <span className="text-5xl mb-3 block max-md:text-4xl max-sm:text-3xl">
              📄
            </span>
            <p className="text-base text-text-h mb-1 max-md:text-sm">
              Drop your Excel file here or{" "}
              <span className="font-semibold">click to browse</span>
            </p>
            <p className="text-[13px] text-text">
              Accepts .xlsx and .xls files up to {MAX_FILE_SIZE_MB} MB
            </p>
          </>
        ) : (
          <>
            <span className="text-5xl mb-3 block max-md:text-4xl max-sm:text-3xl">
              ✅
            </span>
            <p className="text-base text-text-h">
              File loaded — click to replace
            </p>
          </>
        )}
      </div>

      {/* File info */}
      {file && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-accent-bg px-4 py-4 max-md:px-3 max-sm:flex-col max-sm:items-start max-sm:gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[28px] shrink-0">📊</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-h truncate">
                {file.name}
              </p>
              <p className="text-xs text-text mt-0.5">
                {formatBytes(file.size)} &middot; {sheetNames.length} sheet
                {sheetNames.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            className="rounded p-1 text-text text-xl transition-colors hover:bg-black/8 max-sm:self-end"
            onClick={(e) => {
              e.stopPropagation();
              removeFile();
            }}
            title="Remove file"
          >
            ✕
          </button>
        </div>
      )}

      {/* Month & Year */}
      {file && (
        <div className="mt-4 flex gap-4 max-sm:flex-col max-sm:gap-3">
          <div className="flex-1">
            <label className="block text-sm font-semibold text-text-h mb-1.5">
              Month
              {monthAutoDetected && (
                <span className="ml-1.5 text-xs font-normal text-accent">
                  (auto-detected)
                </span>
              )}
            </label>
            <select
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setMonthAutoDetected(false);
              }}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-h transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-bg"
            >
              <option value="">Select month</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-semibold text-text-h mb-1.5">
              Year
              {yearAutoDetected && (
                <span className="ml-1.5 text-xs font-normal text-accent">
                  (auto-detected)
                </span>
              )}
            </label>
            <input
              type="number"
              min="2020"
              max="2099"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setYearAutoDetected(false);
              }}
              placeholder="e.g. 2026"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-h transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-bg"
            />
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[#ef4444] max-md:text-[13px] max-md:px-3 max-md:py-2.5">
          <p className="font-bold">Validation Issues</p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Data preview */}
      {sheetData.length > 0 && columns.length > 0 && (
        <div className="mt-6 text-left">
          <h3 className="text-sm font-semibold text-text-h mb-3">
            Data Preview (first {sheetData.length} rows)
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[13px] max-md:text-xs">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap bg-code-bg px-3 py-2 text-left font-semibold text-text-h border-b border-border"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetData.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="whitespace-nowrap px-3 py-1.5 text-text border-b border-border last:[&:parent:last-child]:border-b-0"
                      >
                        {row[col] !== undefined ? String(row[col]) : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-[#22c55e]">
          {success}
        </div>
      )}

      {/* Submit */}
      <div className="mt-8">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-6 py-3.5 text-base font-semibold text-white transition-all duration-200 hover:brightness-110 hover:-translate-y-px hover:shadow-[rgba(0,0,0,0.1)_0_10px_15px_-3px,rgba(0,0,0,0.05)_0_4px_6px_-2px] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:hover:brightness-100 max-md:py-3 max-md:text-[15px] max-sm:py-3 max-sm:text-sm max-sm:rounded-lg"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {loading && (
            <span className="inline-block h-4.5 w-4.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {loading
            ? progress || "Generating..."
            : "Generate & Download Salary Slips"}
        </button>
      </div>
    </div>
  );
}
