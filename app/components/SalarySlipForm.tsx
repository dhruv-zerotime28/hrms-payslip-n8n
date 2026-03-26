"use client";

import {
  useState,
  useRef,
  useCallback,
  useMemo,
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
  "Gross",
  "Retention Bonus",
  "PT",
  "TDS",
  "Total  Payble",
  "Branch",
  "Bank A/c No.",
  "IFSC CODE",
  "Emp Mail",
  "PAN No."
];

const SALARY_SHEET_KEYWORDS = ["salary", "sal", "payroll", "wages"];
const MAX_FILE_SIZE_MB = 5;
const MAX_HEADER_SCAN_ROWS = 15;
const MIN_HEADER_MATCH_COUNT = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
] as const;

function extractMonthYearFromCells(cells: string[]): {
  month: string;
  year: string;
} {
  let month = "";
  let year = "";

  for (const raw of cells) {
    let cell = String(raw ?? "").trim();
    if (!cell) continue;

    // If the value looks like a pure number, it might be an Excel date serial
    const num = Number(cell);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      // Convert Excel serial to JS Date (Excel epoch: 1899-12-30)
      const date = new Date((num - 25569) * 86400000);
      if (!isNaN(date.getTime())) {
        const m = MONTHS[date.getUTCMonth()];
        const y = String(date.getUTCFullYear());
        if (m) month = m;
        if (y.startsWith("20")) year = y;
        if (month && year) break;
        continue;
      }
    }

    // Try full month name first ("January 2026")
    for (const m of MONTHS) {
      if (cell.toLowerCase().includes(m.toLowerCase())) {
        month = m;
        break;
      }
    }
    // Try short month name ("Feb-26", "Mar 2026")
    if (!month) {
      for (const m of MONTHS) {
        const short = m.slice(0, 3);
        const re = new RegExp(`\\b${short}\\b`, "i");
        if (re.test(cell)) {
          month = m;
          break;
        }
      }
    }
    // Try numeric month ("02/2026", "02-2026")
    if (!month) {
      const numericMatch = cell.match(/\b(0?[1-9]|1[0-2])[\s/\-](20\d{2})\b/);
      if (numericMatch) {
        month = MONTHS[parseInt(numericMatch[1], 10) - 1];
        year = numericMatch[2];
      }
    }

    // Extract 4-digit year
    if (!year) {
      const y4 = cell.match(/\b(20\d{2})\b/);
      if (y4) year = y4[1];
    }
    // Extract 2-digit year from patterns like "Feb-26"
    if (!year) {
      const y2 = cell.match(/[\-/](\d{2})\b/);
      if (y2) year = "20" + y2[1];
    }

    if (month && year) break;
  }

  return { month, year };
}

type SheetRow = Record<string, string | number | undefined>;
type RawRow = (string | number | undefined)[];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}

function normalizeCol(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function findCol(cols: string[], ...targets: string[]) {
  return cols.find((c) => targets.includes(normalizeCol(c)));
}

function detectHeaderRow(rawData: RawRow[]): number {
  for (let i = 0; i < Math.min(rawData.length, MAX_HEADER_SCAN_ROWS); i++) {
    const row = (rawData[i] || []).map((c) => String(c ?? ""));
    const matches = REQUIRED_COLUMNS.filter((rc) =>
      row.some((cell) => normalizeCol(cell) === normalizeCol(rc)),
    );
    if (matches.length >= MIN_HEADER_MATCH_COUNT) return i;
  }
  return -1;
}

function collectMetadataCells(
  rawData: RawRow[],
  formattedData: RawRow[],
  headerRowIndex: number,
): string[] {
  const cells: string[] = [];
  for (let i = 0; i < headerRowIndex; i++) {
    const rawRow = rawData[i] || [];
    const fmtRow = formattedData[i] || [];
    for (let j = 0; j < Math.max(rawRow.length, fmtRow.length); j++) {
      const fmtVal = fmtRow[j];
      if (fmtVal != null && String(fmtVal).trim()) cells.push(String(fmtVal));
      const rawVal = rawRow[j];
      if (rawVal != null && typeof rawVal === "number")
        cells.push(String(rawVal));
    }
  }
  return cells;
}

function validateRows(
  jsonData: SheetRow[],
  fileColumns: string[],
  headerRowIndex: number,
): string[] {
  const issues: string[] = [];
  const nameKey = findCol(fileColumns, "name");
  const srNoKey = findCol(fileColumns, "sr.no.", "srno", "sr.no");
  const emailKey = findCol(fileColumns, "empmail");

  for (let idx = 0; idx < jsonData.length; idx++) {
    const row = jsonData[idx];
    const empName = nameKey ? String(row[nameKey] ?? "").trim() : "";
    const empSrNo = srNoKey ? String(row[srNoKey] ?? "").trim() : "";
    const empLabel = empName
      ? `${empName}${empSrNo ? ` (Sr. No. ${empSrNo})` : ""}`
      : `Row ${headerRowIndex + idx + 2}`;

    const missing = REQUIRED_COLUMNS.filter((col) => {
      const key = fileColumns.find(
        (fc) => normalizeCol(fc) === normalizeCol(col),
      );
      return key && (row[key] === undefined || row[key] === "");
    });
    if (missing.length > 0) {
      issues.push(`${empLabel}: missing ${missing.join(", ")}`);
    }

    if (emailKey) {
      const email = String(row[emailKey] ?? "").trim();
      if (email && !EMAIL_RE.test(email)) {
        issues.push(`${empLabel}: invalid email "${email}"`);
      }
    }
  }
  return issues;
}

export default function SalarySlipForm() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetCount, setSheetCount] = useState(0);
  const [sheetData, setSheetData] = useState<SheetRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [success, setSuccess] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [sendMail, setSendMail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Reset all state ────────────────────────────────── */

  const resetState = useCallback(() => {
    setFile(null);
    setSheetCount(0);
    setSheetData([]);
    setColumns([]);
    setErrors([]);
    setSuccess("");
    setProgress("");
    setMonth("");
    setYear("");
    setSelectedRows(new Set());
    setSearchQuery("");
    setSendMail(false);
  }, []);

  /* ── Validation ─────────────────────────────────────── */

  const validateSheet = useCallback((wb: XLSX.WorkBook, sheetName: string) => {
    const worksheet = wb.Sheets[sheetName];
    const validationErrors: string[] = [];

    const rawData = XLSX.utils.sheet_to_json<RawRow>(worksheet, { header: 1 });
    if (rawData.length === 0) {
      validationErrors.push(`Sheet "${sheetName}" has no data rows.`);
      setSheetData([]);
      setColumns([]);
      setErrors(validationErrors);
      return;
    }

    const headerRowIndex = detectHeaderRow(rawData);
    if (headerRowIndex === -1) {
      validationErrors.push(
        "Could not find the data table header row. Ensure the sheet contains the required columns.",
      );
      setSheetData([]);
      setColumns([]);
      setErrors(validationErrors);
      return;
    }

    // Extract month/year from metadata above the header
    const formattedData = XLSX.utils.sheet_to_json<RawRow>(worksheet, {
      header: 1,
      raw: false,
    });
    const metaCells = collectMetadataCells(
      rawData,
      formattedData,
      headerRowIndex,
    );
    const { month: m, year: y } = extractMonthYearFromCells(metaCells);
    if (m) setMonth(m);
    if (y) setYear(y);

    // Parse data from header row
    const jsonData = XLSX.utils.sheet_to_json<SheetRow>(worksheet, {
      range: headerRowIndex,
    });
    if (jsonData.length === 0) {
      validationErrors.push(`Sheet "${sheetName}" has no data rows.`);
      setSheetData([]);
      setColumns([]);
      setErrors(validationErrors);
      return;
    }

    const fileColumns = Object.keys(jsonData[0]);
    setColumns(fileColumns);

    // Check missing columns
    const missingCols = REQUIRED_COLUMNS.filter(
      (col) =>
        !fileColumns.some((fc) => normalizeCol(fc) === normalizeCol(col)),
    );
    if (missingCols.length > 0) {
      validationErrors.push(
        `Missing required columns: ${missingCols.join(", ")}`,
      );
    }

    // Validate per-row data
    const rowIssues = validateRows(jsonData, fileColumns, headerRowIndex);
    if (rowIssues.length > 0) {
      validationErrors.push(...rowIssues.slice(0, 10));
      if (rowIssues.length > 10) {
        validationErrors.push(`...and ${rowIssues.length - 10} more issues`);
      }
    }

    setSheetData(jsonData);
    setSelectedRows(new Set(jsonData.map((_, i) => i)));
    setErrors(validationErrors);
  }, []);

  const parseFile = useCallback(
    (selectedFile: File) => {
      resetState();

      const ext = selectedFile.name.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xls") {
        setErrors([
          "Invalid file type. Only .xlsx and .xls files are accepted.",
        ]);
        return;
      }
      if (selectedFile.size > MAX_FILE_SIZE_MB * 1048576) {
        setErrors([`File size exceeds ${MAX_FILE_SIZE_MB} MB limit.`]);
        return;
      }

      setFile(selectedFile);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          setSheetCount(wb.SheetNames.length);

          const salarySheet = wb.SheetNames.find((name) =>
            SALARY_SHEET_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)),
          );
          validateSheet(wb, salarySheet || wb.SheetNames[0]);
        } catch {
          setErrors([
            "Failed to parse the Excel file. Please ensure it is a valid .xlsx/.xls file.",
          ]);
          setFile(null);
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    },
    [resetState, validateSheet],
  );

  /* ── Drag / file handlers ───────────────────────────── */

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) parseFile(droppedFile);
    },
    [parseFile],
  );

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) parseFile(selected);
      e.target.value = "";
    },
    [parseFile],
  );

  /* ── Submit ─────────────────────────────────────────── */

  const handleSubmit = useCallback(async () => {
    if (!file || selectedRows.size === 0) return;

    setLoading(true);
    setErrors([]);
    setSuccess("");
    setProgress("Sending to server...");

    try {
      const selectedData = Array.from(selectedRows)
        .sort((a, b) => a - b)
        .map((i) => sheetData[i]);

      const srNoCol = findCol(columns, "sr.no.", "srno", "sr.no");
      const employeeIds = srNoCol
        ? selectedData
            .map((row) => String(row[srNoCol] ?? "").trim())
            .filter(Boolean)
        : [];

      const formData = new FormData();
      formData.append("file", file);
      formData.append(
        "metadata",
        JSON.stringify({ month, year, sendMail, employeeIds }),
      );

      const response = await fetch("/api/generate-salary-slip", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Server error: ${response.status}`);
      }

      setProgress("Downloading ZIP...");
      const zipBlob = await response.blob();
      saveAs(zipBlob, "salary-slips.zip");

      setSuccess("Salary slips generated and downloaded!");
      resetState();
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
  }, [
    file,
    month,
    year,
    selectedRows,
    sendMail,
    columns,
    sheetData,
    resetState,
  ]);

  const canSubmit =
    file &&
    errors.length === 0 &&
    !loading &&
    month &&
    year &&
    selectedRows.size > 0;

  /* ── Derived state ──────────────────────────────────── */

  const nameCol = useMemo(() => findCol(columns, "name"), [columns]);
  const designationCol = useMemo(
    () => findCol(columns, "designation"),
    [columns],
  );
  const branchCol = useMemo(() => findCol(columns, "branch"), [columns]);

  const filteredEmployees = useMemo(() => {
    const items = sheetData.map((row, idx) => ({ row, idx }));
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(({ row }) => {
      const name = nameCol ? String(row[nameCol] ?? "").toLowerCase() : "";
      const designation = designationCol
        ? String(row[designationCol] ?? "").toLowerCase()
        : "";
      const branch = branchCol
        ? String(row[branchCol] ?? "").toLowerCase()
        : "";
      return name.includes(q) || designation.includes(q) || branch.includes(q);
    });
  }, [sheetData, searchQuery, nameCol, designationCol, branchCol]);

  const allFilteredSelected =
    filteredEmployees.length > 0 &&
    filteredEmployees.every(({ idx }) => selectedRows.has(idx));

  const toggleRow = useCallback((idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAllFiltered = useCallback(() => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredEmployees.forEach(({ idx }) => next.delete(idx));
      } else {
        filteredEmployees.forEach(({ idx }) => next.add(idx));
      }
      return next;
    });
  }, [allFilteredSelected, filteredEmployees]);

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-180 px-6 py-12 max-md:px-4 max-md:py-8 max-sm:px-3 max-sm:py-6">
      {/* Header */}
      <header className="mb-10 max-md:mb-7 text-center">
        <h1 className="text-5xl font-bold text-accent mb-10 max-md:text-[28px] max-md:mb-6 max-sm:text-[22px] max-sm:mb-4">
          ZEROTIME SOLUTIONS
        </h1>
        <h2 className="text-[32px] font-bold text-text-h mb-2 max-md:text-[22px] max-sm:text-lg">
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
                {formatBytes(file.size)} &middot; {sheetCount} sheet
                {sheetCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            className="rounded p-1 text-text text-xl transition-colors hover:bg-black/8 max-sm:self-end"
            onClick={(e) => {
              e.stopPropagation();
              resetState();
            }}
            title="Remove file"
          >
            ✕
          </button>
        </div>
      )}

      {/* Month & Year (read from sheet metadata) */}
      {file && month && year && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-code-bg px-4 py-3 text-sm text-text-h">
          <span className="text-lg">📅</span>
          <span>
            Salary period:{" "}
            <strong>
              {month} {year}
            </strong>
          </span>
        </div>
      )}
      {file && (!month || !year) && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[#ef4444]">
          Could not detect month/year from the sheet metadata. Please ensure the
          sheet has a date (e.g. &quot;Feb-26&quot;) above the data table.
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

      {/* Employee selection table */}
      {sheetData.length > 0 && columns.length > 0 && (
        <div className="mt-6 text-left">
          <h3 className="text-sm font-semibold text-text-h mb-3">
            Select Employees ({selectedRows.size} of {sheetData.length}{" "}
            selected)
          </h3>

          {/* Table toolbar: search + send mail toggle */}
          <div className="flex items-center gap-4 mb-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
            {/* Search */}
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text text-sm pointer-events-none">
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, designation, or branch..."
                className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm text-text-h transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-bg"
              />
            </div>

            {/* Send Mail toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none shrink-0 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent-bg">
              <span className="text-sm font-medium text-text-h whitespace-nowrap">
                📧 Send Mail
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={sendMail}
                onClick={() => setSendMail((v) => !v)}
                className={`relative inline-flex h-5.5 w-10 shrink-0 rounded-full transition-colors duration-200 ${
                  sendMail ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 translate-y-0.5 ${
                    sendMail ? "translate-x-4.75" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
          </div>

          {sendMail && (
            <p className="text-xs text-accent mb-3">
              Salary slips will be emailed to selected employees after
              generation.
            </p>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-border max-h-105 overflow-y-auto">
            <table className="min-w-max w-full border-collapse text-[13px] max-md:text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="whitespace-nowrap bg-code-bg px-3 py-2 text-left font-semibold text-text-h border-b border-border w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      className="accent-accent h-4 w-4 cursor-pointer"
                      title={
                        allFilteredSelected
                          ? "Deselect all visible"
                          : "Select all visible"
                      }
                    />
                  </th>
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
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      className="px-3 py-6 text-center text-text"
                    >
                      No employees match your search.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map(({ row, idx }) => (
                    <tr
                      key={idx}
                      className={`cursor-pointer transition-colors ${
                        selectedRows.has(idx)
                          ? "bg-accent-bg"
                          : "hover:bg-code-bg"
                      }`}
                      onClick={() => toggleRow(idx)}
                    >
                      <td className="px-3 py-1.5 border-b border-border w-10">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(idx)}
                          onChange={() => toggleRow(idx)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-accent h-4 w-4 cursor-pointer"
                        />
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="whitespace-nowrap px-3 py-1.5 text-text border-b border-border"
                        >
                          {row[col] !== undefined ? String(row[col]) : ""}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
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
            : `Generate${sendMail ? " & Mail" : ""} Salary Slips (${selectedRows.size})`}
        </button>
      </div>
    </div>
  );
}
