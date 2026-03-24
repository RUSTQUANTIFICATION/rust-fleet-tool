// web/src/lib/reportDb.ts
import { supabaseBrowser } from "./supabaseBrowser";

export type ReportRow = {
  id: string;
  vessel_id: string;
  area_type: string | null;
  session_id: string | null;
  report_type: string;
  report_path: string | null;
  file_path?: string | null;
  created_at: string;
};

const REPORTS_BUCKET = "rust-reports";

function normalizeReportPath(path: string | null | undefined): string | null {
  if (!path) return null;

  let value = String(path).trim();
  if (!value) return null;

  value = value.replace(/^\/+/, "");

  if (value.startsWith(`${REPORTS_BUCKET}/`)) {
    value = value.slice(REPORTS_BUCKET.length + 1);
  }

  const publicMarker = `/object/public/${REPORTS_BUCKET}/`;
  const signMarker = `/object/sign/${REPORTS_BUCKET}/`;

  const publicIdx = value.indexOf(publicMarker);
  if (publicIdx >= 0) {
    value = value.slice(publicIdx + publicMarker.length);
  }

  const signIdx = value.indexOf(signMarker);
  if (signIdx >= 0) {
    value = value.slice(signIdx + signMarker.length);
    const qIndex = value.indexOf("?");
    if (qIndex >= 0) value = value.slice(0, qIndex);
  }

  if (value.startsWith("reports/reports/")) {
    value = value.replace(/^reports\/reports\//, "reports/");
  }

  if (!value.startsWith("reports/")) {
    value = `reports/${value}`;
  }

  return value;
}

export function getReportStoragePath(row: {
  report_path?: string | null;
  file_path?: string | null;
}): string | null {
  return normalizeReportPath(row.file_path || row.report_path || null);
}

export async function getReports(vesselId?: string) {
  const sb = supabaseBrowser();

  let q = sb
    .from("reports")
    .select("id,vessel_id,area_type,session_id,report_type,report_path,file_path,created_at")
    .order("created_at", { ascending: false });

  if (vesselId) {
    q = q.eq("vessel_id", vesselId);
  }

  const { data, error } = await q;
  if (error) throw error;

  return ((data || []) as ReportRow[]).map((row) => ({
    ...row,
    report_path: normalizeReportPath(row.report_path),
    file_path: normalizeReportPath(row.file_path),
  }));
}

export async function getSignedReportUrl(
  input: string | { report_path?: string | null; file_path?: string | null },
  expiresIn = 3600
) {
  const sb = supabaseBrowser();

  const path =
    typeof input === "string" ? normalizeReportPath(input) : getReportStoragePath(input);

  if (!path) {
    console.error("No valid report path found");
    return null;
  }

  const { data, error } = await sb.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error("Signed report URL error:", error);
    console.error("Bucket:", REPORTS_BUCKET);
    console.error("Path:", path);
    return null;
  }

  return data?.signedUrl || null;
}

export async function downloadReportBlobUrl(
  input: string | { report_path?: string | null; file_path?: string | null }
) {
  const sb = supabaseBrowser();

  const path =
    typeof input === "string" ? normalizeReportPath(input) : getReportStoragePath(input);

  console.log("DOWNLOAD REPORT PATH =", path);

  if (!path) {
    console.error("No valid report path found");
    return null;
  }

  const { data, error } = await sb.storage
    .from(REPORTS_BUCKET)
    .download(path);

  if (error) {
    console.error("Download report error:", error);
    console.error("Bucket:", REPORTS_BUCKET);
    console.error("Path:", path);
    return null;
  }

  if (!data) {
    console.error("No report blob returned");
    return null;
  }

  return URL.createObjectURL(data);
}