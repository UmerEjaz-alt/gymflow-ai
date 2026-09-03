"use client";

import { FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { normalizeImportName, parseImportDate } from "@/lib/member-import";
import { normalizePhoneNumber } from "@/lib/phone-number";
import type {
  MemberImportInput,
  MemberImportResult,
} from "@/services/membership.server";
import type { MembershipPackage } from "@/types/membership-package";

type SourceRow = { number: number; values: Record<string, string> };
type Mapping = Record<
  "name" | "phone" | "packageName" | "startDate" | "expiryDate",
  string
>;

const EMPTY_MAPPING: Mapping = {
  name: "",
  phone: "",
  packageName: "",
  startDate: "",
  expiryDate: "",
};

function normalizedHeader(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function detectMapping(headers: string[]): Mapping {
  const find = (patterns: RegExp[]) =>
    headers.find((header) =>
      patterns.some((pattern) => pattern.test(normalizedHeader(header))),
    ) ?? "";
  return {
    name: find([/^name$/, /member.*name/, /customer.*name/, /full.*name/]),
    phone: find([/^phone$/, /mobile/, /contact.*number/, /telephone/, /whatsapp/]),
    packageName: find([/package/, /membership.*plan/, /^plan$/]),
    startDate: find([/start.*date/, /join.*date/, /membership.*start/]),
    expiryDate: find([/expiry/, /end.*date/, /membership.*end/]),
  };
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

async function parseSpreadsheet(
  file: File,
): Promise<{ headers: string[]; rows: SourceRow[] }> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    cellDates: true,
    cellFormula: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet?.["!ref"]) throw new Error("The file does not contain a worksheet.");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const cellText = (cell: (typeof sheet)[string] | undefined) => {
    if (!cell || cell.f) return "";
    if (cell.t === "d" && cell.v instanceof Date) {
      return toIsoDate(
        cell.v.getUTCFullYear(),
        cell.v.getUTCMonth() + 1,
        cell.v.getUTCDate(),
      );
    }
    if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
      const date = XLSX.SSF.parse_date_code(cell.v as number);
      return date ? toIsoDate(date.y, date.m, date.d) : "";
    }
    return XLSX.utils.format_cell(cell).trim();
  };
  const headers = Array.from(
    { length: range.e.c - range.s.c + 1 },
    (_, index) =>
      cellText(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + index })]) ||
      `Column ${index + 1}`,
  );
  const rows: SourceRow[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const values = Object.fromEntries(
      headers.map((header, index) => [
        header,
        cellText(sheet[XLSX.utils.encode_cell({ r: row, c: range.s.c + index })]),
      ]),
    );
    if (Object.values(values).some(Boolean)) rows.push({ number: row + 1, values });
  }
  return { headers, rows };
}

type Props = {
  packages: MembershipPackage[];
  countryCode: string | null;
  onImport: (
    rows: MemberImportInput[],
  ) => Promise<{ data: MemberImportResult | null; error: string | null }>;
};

export function MemberImportDialog({ packages, countryCode, onImport }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<MemberImportResult | null>(null);

  const preview = useMemo(() => {
    const seen = new Set<string>();
    const packageNames = new Map<string, number>();
    packages
      .filter((pkg) => pkg.active)
      .forEach((pkg) =>
        packageNames.set(
          normalizeImportName(pkg.package_name),
          (packageNames.get(normalizeImportName(pkg.package_name)) ?? 0) + 1,
        ),
      );
    return rows.map((row) => {
      const value = (field: keyof Mapping) =>
        mapping[field] ? (row.values[mapping[field]] ?? "") : "";
      const phone = normalizePhoneNumber(value("phone"), countryCode);
      const start = parseImportDate(value("startDate"));
      const expiry = parseImportDate(value("expiryDate"));
      const errors: string[] = [];
      if (!value("name").trim()) errors.push("Name is required.");
      if (!phone.e164) errors.push(phone.error!);
      else if (seen.has(phone.e164)) errors.push("Duplicate phone in file.");
      else seen.add(phone.e164);
      const packageName = value("packageName");
      if (!packageName.trim()) errors.push("Package is required.");
      else if (packageNames.get(normalizeImportName(packageName)) !== 1)
        errors.push("Package does not match this branch.");
      if (start.error) errors.push(start.error);
      if (expiry.error) errors.push(expiry.error);
      if (start.value && expiry.value && expiry.value <= start.value)
        errors.push("Expiry must be after start.");
      return {
        row,
        name: value("name"),
        originalPhone: value("phone"),
        normalizedPhone: phone.e164 ?? "—",
        packageName,
        startDate: value("startDate"),
        expiryDate: value("expiryDate"),
        errors,
      };
    });
  }, [countryCode, mapping, packages, rows]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      toast("Use a CSV or XLSX file up to 5 MB.", "error");
      return;
    }
    setLoadingFile(true);
    setResult(null);
    try {
      const parsed = await parseSpreadsheet(file);
      if (!parsed.rows.length) throw new Error("No data rows were found.");
      if (parsed.rows.length > 500)
        throw new Error("Imports are limited to 500 rows at a time.");
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(detectMapping(parsed.headers));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not read this file.",
        "error",
      );
    } finally {
      setLoadingFile(false);
    }
  }

  async function importRows() {
    if (!mapping.name || !mapping.phone || !mapping.packageName) {
      toast("Map Name, Phone, and Membership Package before importing.", "error");
      return;
    }
    setImporting(true);
    try {
      const response = await onImport(
        preview.map((item) => ({
          rowNumber: item.row.number,
          name: item.name,
          phone: item.originalPhone,
          packageName: item.packageName,
          startDate: item.startDate,
          expiryDate: item.expiryDate,
        })),
      );
      if (response.error || !response.data) {
        toast(response.error ?? "Could not import members.", "error");
        return;
      }
      setResult(response.data);
      router.refresh();
      toast(
        `${response.data.imported_count} member${response.data.imported_count === 1 ? "" : "s"} imported.`,
        "success",
      );
    } finally {
      setImporting(false);
    }
  }

  function close() {
    if (importing) return;
    setOpen(false);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="size-4" /> Import members
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Import members"
        description="Import CSV or Excel data into the currently selected branch. Existing members are never overwritten."
        size="max-w-5xl"
        panelClassName="max-h-[calc(100vh-2rem)]"
        contentClassName="overflow-y-auto"
      >
        {!rows.length ? (
          <div className="space-y-4">
            <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center rounded-xl border border-dashed p-10 text-center">
              {loadingFile ? (
                <LoaderCircle className="size-6 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-6" />
              )}
              <span className="mt-3 text-sm font-medium">
                Choose a CSV or Excel file
              </span>
              <span className="text-muted-foreground mt-1 text-xs">
                Up to 500 rows · 5 MB · CSV or XLSX
              </span>
              <Input
                className="sr-only"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={loadingFile}
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
            </label>
            {!countryCode ? (
              <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-800">
                Local-format numbers need a Default Phone Country in this branch’s
                settings. Numbers beginning with + can still be imported.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {(
                ["name", "phone", "packageName", "startDate", "expiryDate"] as const
              ).map((field) => (
                <label key={field} className="text-xs font-medium">
                  {
                    {
                      name: "Name",
                      phone: "Phone",
                      packageName: "Package",
                      startDate: "Start date",
                      expiryDate: "Expiry date",
                    }[field]
                  }
                  <Select
                    className="mt-1"
                    value={mapping[field]}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  >
                    <option value="">
                      {field === "startDate" || field === "expiryDate"
                        ? "Not included"
                        : "Select column"}
                    </option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3">Row</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Original phone</th>
                    <th className="p-3">Normalized phone</th>
                    <th className="p-3">Package</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map((item) => (
                    <tr key={item.row.number} className="border-t">
                      <td className="p-3">{item.row.number}</td>
                      <td className="p-3">{item.name || "—"}</td>
                      <td className="p-3">{item.originalPhone || "—"}</td>
                      <td className="p-3">{item.normalizedPhone}</td>
                      <td className="p-3">{item.packageName || "—"}</td>
                      <td
                        className={
                          item.errors.length
                            ? "p-3 text-red-700"
                            : "p-3 text-emerald-700"
                        }
                      >
                        {item.errors.length ? item.errors.join(" ") : "Ready"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length > 50 ? (
              <p className="text-muted-foreground text-xs">
                Showing the first 50 of {preview.length} rows. All rows are validated
                again on import.
              </p>
            ) : null}
            {result ? (
              <div className="bg-muted rounded-lg p-4 text-sm">
                <p>
                  <strong>{result.imported_count}</strong> imported ·{" "}
                  <strong>{result.duplicate_count}</strong> duplicates skipped ·{" "}
                  <strong>{result.failed_count}</strong> failed
                </p>
                {result.row_errors.slice(0, 10).map((error) => (
                  <p
                    key={`${error.rowNumber}-${error.error}`}
                    className="text-muted-foreground mt-1"
                  >
                    Row {error.rowNumber}: {error.error}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Close
              </Button>
              <Button
                type="button"
                disabled={importing || !preview.length}
                onClick={importRows}
              >
                {importing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}{" "}
                Import valid rows
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
