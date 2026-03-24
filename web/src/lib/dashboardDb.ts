// web/src/lib/dashboardDb.ts
import { supabaseBrowser } from "./supabaseBrowser";

export type VesselDashboardRow = {
  vessel_id: string;
  vessel_name: string;
  area_type: string;
  photo_count: number;
  avg_rust_pct: number;
  max_rust_pct: number;
  latest_inspection_at: string | null;
  severe_count: number;
};

export type VesselOverallRow = {
  vessel_id: string;
  vessel_name: string;
  total_photos: number;
  overall_avg_rust_pct: number;
  overall_max_rust_pct: number;
  latest_inspection_at: string | null;
};

export async function getAutoVesselDashboard(vesselId?: string) {
  const sb = supabaseBrowser();

  const { data: vesselsData, error: vesselsError } = await sb
    .from("vessels")
    .select("id,name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (vesselsError) throw vesselsError;

  const { data: photosData, error: photosError } = await sb
    .from("inspection_photos")
    .select("id,session_id,vessel_id,area_type,location_tag,image_path,created_at")
    .order("created_at", { ascending: false });

  if (photosError) throw photosError;

  const { data: findingsData, error: findingsError } = await sb
    .from("photo_findings")
    .select("photo_id,rust_pct,overall_severity");

  if (findingsError) throw findingsError;

  const vesselMap = new Map<string, string>();
  (vesselsData || []).forEach((v: any) => vesselMap.set(v.id, v.name));

  const findingMap = new Map<
    string,
    { rust_pct: number; overall_severity: string | null }
  >();
  (findingsData || []).forEach((f: any) => {
    findingMap.set(f.photo_id, {
      rust_pct: Number(f.rust_pct || 0),
      overall_severity: f.overall_severity || null,
    });
  });

  let photos = (photosData || []) as Array<{
    id: string;
    session_id: string;
    vessel_id: string;
    area_type: string;
    location_tag: string | null;
    image_path: string | null;
    created_at: string;
  }>;

  if (vesselId) {
    photos = photos.filter((p) => p.vessel_id === vesselId);
  }

  const grouped = new Map<string, VesselDashboardRow>();
  const groupedOverall = new Map<string, VesselOverallRow>();

  for (const p of photos) {
    const finding = findingMap.get(p.id);
    const rust = Number(finding?.rust_pct || 0);
    const sev = (finding?.overall_severity || "").toUpperCase();
    const vesselName = vesselMap.get(p.vessel_id) || "Unknown Vessel";

    const areaKey = `${p.vessel_id}__${p.area_type}`;
    const existingArea = grouped.get(areaKey) || {
      vessel_id: p.vessel_id,
      vessel_name: vesselName,
      area_type: p.area_type,
      photo_count: 0,
      avg_rust_pct: 0,
      max_rust_pct: 0,
      latest_inspection_at: null,
      severe_count: 0,
    };

    existingArea.photo_count += 1;
    existingArea.avg_rust_pct += rust;
    existingArea.max_rust_pct = Math.max(existingArea.max_rust_pct, rust);

    if (!existingArea.latest_inspection_at || p.created_at > existingArea.latest_inspection_at) {
      existingArea.latest_inspection_at = p.created_at;
    }

    if (sev === "SEVERE" || sev === "HIGH") {
      existingArea.severe_count += 1;
    }

    grouped.set(areaKey, existingArea);

    const overall = groupedOverall.get(p.vessel_id) || {
      vessel_id: p.vessel_id,
      vessel_name: vesselName,
      total_photos: 0,
      overall_avg_rust_pct: 0,
      overall_max_rust_pct: 0,
      latest_inspection_at: null,
    };

    overall.total_photos += 1;
    overall.overall_avg_rust_pct += rust;
    overall.overall_max_rust_pct = Math.max(overall.overall_max_rust_pct, rust);

    if (!overall.latest_inspection_at || p.created_at > overall.latest_inspection_at) {
      overall.latest_inspection_at = p.created_at;
    }

    groupedOverall.set(p.vessel_id, overall);
  }

  const areaRows = Array.from(grouped.values()).map((r) => ({
    ...r,
    avg_rust_pct: Number((r.avg_rust_pct / Math.max(1, r.photo_count)).toFixed(2)),
    max_rust_pct: Number(r.max_rust_pct.toFixed(2)),
  }));

  const vesselRows = Array.from(groupedOverall.values()).map((r) => ({
    ...r,
    overall_avg_rust_pct: Number((r.overall_avg_rust_pct / Math.max(1, r.total_photos)).toFixed(2)),
    overall_max_rust_pct: Number(r.overall_max_rust_pct.toFixed(2)),
  }));

  areaRows.sort((a, b) => b.max_rust_pct - a.max_rust_pct);
  vesselRows.sort((a, b) => b.overall_max_rust_pct - a.overall_max_rust_pct);

  return {
    vesselRows,
    areaRows,
  };
}