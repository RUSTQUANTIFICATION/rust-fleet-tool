// web/src/lib/inspectionConfig.ts

export type AreaType =
  | "CARGO_HOLD"
  | "MAIN_DECK"
  | "VOID_SPACE"
  | "CARGO_TANK"
  | "BALLAST_TANK";

export const AREA_TYPE_OPTIONS = [
  { value: "CARGO_HOLD", label: "Cargo Hold", frequency: "As and when needed" },
  { value: "MAIN_DECK", label: "Main Deck", frequency: "Monthly" },
  { value: "VOID_SPACE", label: "Void Space", frequency: "Every DD" },
  { value: "CARGO_TANK", label: "Cargo Tank", frequency: "As and when needed" },
  { value: "BALLAST_TANK", label: "Ballast Tank", frequency: "Every DD" },
] as const;

export const CARGO_HOLD_LOCATIONS = [
  "fwd_bulkhead",
  "aft_bulkhead",
  "stbd_bulkhead",
  "port_bulkhead",
  "underside_hatch_cover",
  "floor",
  "topside_hatch_cover",
  "portside_hatch_cover",
  "stbdside_hatch_cover",
  "fwd_hatch_cover",
  "aft_hatch_cover",
] as const;

export type CargoHoldLocation = (typeof CARGO_HOLD_LOCATIONS)[number];

export const SPACE_AREA_TYPES = ["VOID_SPACE", "CARGO_TANK", "BALLAST_TANK"] as const;
export type SpaceAreaType = (typeof SPACE_AREA_TYPES)[number];

export const REQUIRED_COUNTS = {
  MAIN_DECK: 10,
  VOID_SPACE: 5,
  BALLAST_TANK: 10,
  CARGO_HOLD_PER_LOCATION: 1,
} as const;

export function labelizeLocation(key: string) {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function getAreaLabel(areaType: string) {
  const match = AREA_TYPE_OPTIONS.find((x) => x.value === areaType);
  return match?.label || areaType;
}

export function getAreaFrequency(areaType: string) {
  const match = AREA_TYPE_OPTIONS.find((x) => x.value === areaType);
  return match?.frequency || "";
}

export const ACCEPTED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const MAX_FILE_MB = 5;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;