// web/src/lib/rustDb.ts
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import type { AreaType, SpaceAreaType } from "@/lib/inspectionConfig";

export type VesselRow = {
  id: string;
  name: string;
  code: string | null;
  fleet_group: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export type CreateSessionInput = {
  vessel_id: string;
  area_type: AreaType; // CARGO_HOLD | MAIN_DECK | VOID_SPACE | CARGO_TANK | BALLAST_TANK
  hold_no?: number | null;
  tank_type?: SpaceAreaType | null; // VOID_SPACE | CARGO_TANK | BALLAST_TANK
  tank_no?: string | null;
  notes?: string | null;
};

export type PhotoInsertInput = {
  session_id: string;
  vessel_id: string;
  area_type: AreaType;
  location_tag: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  taken_at?: string | null;
};

export type FindingsInsertInput = {
  photo_id: string;
  rust_pct_total: number;
  rust_pct_light?: number | null;
  rust_pct_moderate?: number | null;
  rust_pct_heavy?: number | null;

  blistering_pct?: number | null;
  cracking_pct?: number | null;
  coating_failure_pct?: number | null;

  severity?: string | null;
  confidence?: number | null;
  warnings?: any | null;

  phash?: string | null;
  dup_group_id?: string | null;
  is_duplicate?: boolean | null;
};

export function safeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapAreaTypeToDb(input: any, tankType?: any): AreaType {
  const normalize = (val: any) =>
    String(val || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");

  const area = normalize(input);
  const tank = normalize(tankType);

  // Direct match (correct values)
  if (area === "CARGO_HOLD") return "CARGO_HOLD";
  if (area === "MAIN_DECK") return "MAIN_DECK";
  if (area === "VOID_SPACE") return "VOID_SPACE";
  if (area === "CARGO_TANK") return "CARGO_TANK";
  if (area === "BALLAST_TANK") return "BALLAST_TANK";

  // Handle UI labels (VERY IMPORTANT FIX)
  if (area === "CARGO_HOLD" || area === "CARGOHOLD") return "CARGO_HOLD";
  if (area === "MAIN_DECK" || area === "MAINDECK") return "MAIN_DECK";
  if (area === "VOID_SPACE" || area === "VOIDSPACE") return "VOID_SPACE";
  if (area === "BALLAST_TANK" || area === "BALLASTTANK") return "BALLAST_TANK";
  if (area === "CARGO_TANK" || area === "CARGOTANK") return "CARGO_TANK";

  // Fallback from tank type
  if (tank === "VOID_SPACE") return "VOID_SPACE";
  if (tank === "BALLAST_TANK") return "BALLAST_TANK";
  if (tank === "CARGO_TANK") return "CARGO_TANK";

  console.error("❌ INVALID AREA TYPE:", input, "tankType:", tankType);

  throw new Error(`Invalid area_type for DB: ${input}`);
}

function buildAreaName(input: CreateSessionInput) {
  if (input.area_type === "MAIN_DECK") return "Main Deck";

  if (input.area_type === "CARGO_HOLD") {
    return `Hold ${input.hold_no ?? 1}`;
  }

  if (input.area_type === "VOID_SPACE") {
    return `Void Space ${input.tank_no ?? ""}`.trim();
  }

  if (input.area_type === "CARGO_TANK") {
    return `Cargo Tank ${input.tank_no ?? ""}`.trim();
  }

  if (input.area_type === "BALLAST_TANK") {
    return `Ballast Tank ${input.tank_no ?? ""}`.trim();
  }

  return "Inspection Area";
}

export async function getCurrentUserId(): Promise<string> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error("Not logged in");
  return data.user.id;
}

export async function getActiveVessels(): Promise<VesselRow[]> {
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("vessels")
    .select("id,name,code,fleet_group,is_active,created_at")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []) as VesselRow[];
}

export async function createInspectionSession(input: CreateSessionInput) {
  const sb = supabaseBrowser();
  const user_id = await getCurrentUserId();
  
  const dbAreaType = mapAreaTypeToDb(input.area_type, input.tank_type);
  
  console.log("SESSION DEBUG → input:", input.area_type, "mapped:", dbAreaType);

  const areaName = buildAreaName(input);

  const { data, error } = await sb
    .from("inspection_sessions")
    .insert({
      vessel_id: input.vessel_id,
      area_type: dbAreaType,
      area_name: areaName,
      remarks: input.notes ?? null,
      created_by: user_id,
    })
    .select("id,vessel_id,area_type,area_name,created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function insertInspectionPhoto(input: PhotoInsertInput) {
  const sb = supabaseBrowser();
  const user_id = await getCurrentUserId();

  const dbAreaType = mapAreaTypeToDb(input.area_type);

  const { data, error } = await sb
    .from("inspection_photos")
    .insert({
      session_id: input.session_id,
      vessel_id: input.vessel_id,
      area_type: dbAreaType,
      location_tag: input.location_tag,
      image_path: input.file_path,
      taken_at: input.taken_at ?? null,
      created_by: user_id,
    })
    .select("id,session_id,image_path,location_tag,area_type")
    .single();

  if (error) throw error;
  return data;
}

export async function insertPhotoFindings(input: FindingsInsertInput) {
  const sb = supabaseBrowser();

  const severityMap = (s?: string | null) => {
    if (!s) return "LOW";
    const v = s.toUpperCase();
    if (v === "LOW") return "LOW";
    if (v === "MODERATE") return "MODERATE";
    if (v === "HIGH") return "HIGH";
    if (v === "SEVERE") return "SEVERE";
    return "LOW";
  };

  const { data, error } = await sb
    .from("photo_findings")
    .insert({
      photo_id: input.photo_id,
      rust_pct: input.rust_pct_total,
      blistering_pct: input.blistering_pct ?? 0,
      cracking_pct: input.cracking_pct ?? 0,
      coating_failure_pct: input.coating_failure_pct ?? 0,
      overall_severity: severityMap(input.severity),
      confidence: input.confidence ?? 0,
      model_version: "v1",
      analysis_json: {
        rust_pct_light: input.rust_pct_light ?? 0,
        rust_pct_moderate: input.rust_pct_moderate ?? 0,
        rust_pct_heavy: input.rust_pct_heavy ?? 0,
        warnings: input.warnings ?? null,
        phash: input.phash ?? null,
        dup_group_id: input.dup_group_id ?? null,
        is_duplicate: input.is_duplicate ?? null,
      },
    })
    .select("id,photo_id,rust_pct")
    .single();

  if (error) throw error;
  return data;
}

export async function uploadToStorage(args: {
  bucket: string;
  path: string;
  file: File;
  upsert?: boolean;
}) {
  const sb = supabaseBrowser();
  const { data, error } = await sb.storage
    .from(args.bucket)
    .upload(args.path, args.file, {
      upsert: args.upsert ?? true,
      contentType: args.file.type,
    });

  if (error) throw error;
  return data;
}

export async function getSignedUrl(args: {
  bucket: string;
  path: string;
  expiresInSec?: number;
}) {
  const sb = supabaseBrowser();
  const { data, error } = await sb.storage
    .from(args.bucket)
    .createSignedUrl(args.path, args.expiresInSec ?? 60 * 60);

  if (error) throw error;
  return data.signedUrl;
}