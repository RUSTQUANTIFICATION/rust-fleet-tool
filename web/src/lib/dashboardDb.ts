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

export async function getAutoVesselDashboard(vesselId?: string): Promise<{
  vesselRows: VesselOverallRow[];
  areaRows: VesselDashboardRow[];
}> {
  const sb = supabaseBrowser();

  let q = sb
    .from("inspection_photos")
    .select(`
      id,
      vessel_id,
      area_type,
      created_at,
      vessels (
        name
      )
    `)
    .order("created_at", { ascending: false });

  if (vesselId) q = q.eq("vessel_id", vesselId);

  const { data: photos, error: photoError } = await q;
  if (photoError) throw photoError;

  const photoIds = (photos || []).map((p: any) => p.id).filter(Boolean);

  if (photoIds.length === 0) {
    return { vesselRows: [], areaRows: [] };
  }

  const { data: findings, error: findingsError } = await sb
    .from("photo_findings")
    .select(`
      photo_id,
      rust_pct_total,
      overall_severity
    `)
    .in("photo_id", photoIds);

  if (findingsError) throw findingsError;

  const findingsByPhotoId = new Map<string, any>();
  (findings || []).forEach((f: any) => {
    findingsByPhotoId.set(f.photo_id, f);
  });

  const vesselMap = new Map<string, any>();
  const areaMap = new Map<string, any>();

  for (const p of photos || []) {
    const finding = findingsByPhotoId.get((p as any).id);
    const rustPct = Number(finding?.rust_pct_total ?? 0);

    const severity = String(finding?.overall_severity || "").toUpperCase();

    const vesselName = Array.isArray((p as any).vessels)
      ? (p as any).vessels[0]?.name || "-"
      : (p as any).vessels?.name || "-";

    const vesselKey = (p as any).vessel_id;
    const areaKey = `${(p as any).vessel_id}_${(p as any).area_type}`;

    if (!vesselMap.has(vesselKey)) {
      vesselMap.set(vesselKey, {
        vessel_id: (p as any).vessel_id,
        vessel_name: vesselName,
        total_photos: 0,
        overall_avg_rust_pct: 0,
        overall_max_rust_pct: 0,
        latest_inspection_at: null,
        _sum: 0,
      });
    }

    const v = vesselMap.get(vesselKey);
    v.total_photos += 1;
    v._sum += rustPct;
    v.overall_max_rust_pct = Math.max(v.overall_max_rust_pct, rustPct);
    if (!v.latest_inspection_at || String((p as any).created_at) > String(v.latest_inspection_at)) {
      v.latest_inspection_at = (p as any).created_at;
    }

    if (!areaMap.has(areaKey)) {
      areaMap.set(areaKey, {
        vessel_id: (p as any).vessel_id,
        vessel_name: vesselName,
        area_type: (p as any).area_type,
        photo_count: 0,
        avg_rust_pct: 0,
        max_rust_pct: 0,
        severe_count: 0,
        high_severe_count: 0,
        latest_inspection_at: null,
        _sum: 0,
      });
    }

    const a = areaMap.get(areaKey);
    a.photo_count += 1;
    a._sum += rustPct;
    a.max_rust_pct = Math.max(a.max_rust_pct, rustPct);

    if (severity === "HIGH" || severity === "SEVERE" || rustPct >= 8) {
      a.severe_count += 1;
      a.high_severe_count += 1;
    }

    if (!a.latest_inspection_at || String((p as any).created_at) > String(a.latest_inspection_at)) {
      a.latest_inspection_at = (p as any).created_at;
    }
  }

  const vesselRows = Array.from(vesselMap.values()).map((r: any) => {
    const avg = r.total_photos ? r._sum / r.total_photos : 0;
    const { _sum, ...clean } = r;
    return {
      ...clean,
      overall_avg_rust_pct: Number(avg.toFixed(2)),
      overall_max_rust_pct: Number(Number(clean.overall_max_rust_pct || 0).toFixed(2)),
    };
  });

  const areaRows = Array.from(areaMap.values()).map((r: any) => {
    const avg = r.photo_count ? r._sum / r.photo_count : 0;
    const { _sum, ...clean } = r;
    return {
      ...clean,
      avg_rust_pct: Number(avg.toFixed(2)),
      max_rust_pct: Number(Number(clean.max_rust_pct || 0).toFixed(2)),
    };
  });

  return { vesselRows, areaRows };
}