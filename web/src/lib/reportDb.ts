// web/src/lib/reportDb.ts
import { supabaseBrowser } from "./supabaseBrowser";

export type ReportRow = {
  id: string;
  vessel_id: string | null;
  area_type: string | null;
  report_type: string | null;
  file_name: string | null;
  file_path: string | null;
  report_path: string | null;
  report_url: string | null;
  created_at: string | null;
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

  return value;
}

export function getReportStoragePath(row: {
  report_path?: string | null;
  file_path?: string | null;
}): string | null {
  return normalizeReportPath(row.file_path || row.report_path || null);
}

export function getReportPublicUrl(
  input: string | { report_path?: string | null; file_path?: string | null }
): string | null {
  const path =
    typeof input === "string" ? normalizeReportPath(input) : getReportStoragePath(input);

  if (!path) return null;

  const { data } = supabaseBrowser().storage.from(REPORTS_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function getReports(vesselId?: string): Promise<ReportRow[]> {
  const sb = supabaseBrowser();

  let q = sb
    .from("reports")
    .select(
      "id,vessel_id,area_type,report_type,file_name,file_path,report_path,report_url,created_at"
    )
    .order("created_at", { ascending: false });

  if (vesselId) {
    q = q.eq("vessel_id", vesselId);
  }

  const { data, error } = await q;
  if (error) throw error;

  return ((data || []) as any[]).map((row) => ({
    id: row.id,
    vessel_id: row.vessel_id ?? null,
    area_type: row.area_type ?? null,
    report_type: row.report_type ?? null,
    file_name: row.file_name ?? null,
    file_path: normalizeReportPath(row.file_path),
    report_path: normalizeReportPath(row.report_path),
    report_url: row.report_url ?? null,
    created_at: row.created_at ?? null,
  }));
}

export async function getReportsByVesselArea(
  vesselId: string,
  areaType: string
): Promise<ReportRow[]> {
  const sb = supabaseBrowser();

  const { data, error } = await sb
    .from("reports")
    .select(
      "id,vessel_id,area_type,report_type,file_name,file_path,report_path,report_url,created_at"
    )
    .eq("vessel_id", vesselId)
    .eq("area_type", areaType)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data || []) as any[]).map((row) => ({
    id: row.id,
    vessel_id: row.vessel_id ?? null,
    area_type: row.area_type ?? null,
    report_type: row.report_type ?? null,
    file_name: row.file_name ?? null,
    file_path: normalizeReportPath(row.file_path),
    report_path: normalizeReportPath(row.report_path),
    report_url: row.report_url ?? null,
    created_at: row.created_at ?? null,
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

  const { data, error } = await sb.storage.from(REPORTS_BUCKET).download(path);

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