export type InspectionAreaType =
  | "CARGO_HOLD"
  | "MAIN_DECK"
  | "VOID_SPACE"
  | "CARGO_TANK"
  | "BALLAST_TANK";

export type InspectionFrequency =
  | "AS_NEEDED"
  | "MONTHLY"
  | "EVERY_DD";

export const INSPECTION_AREA_CONFIG: Record<
  InspectionAreaType,
  {
    label: string;
    frequency: InspectionFrequency;
  }
> = {
  CARGO_HOLD: {
    label: "Cargo Hold",
    frequency: "AS_NEEDED",
  },
  MAIN_DECK: {
    label: "Main Deck",
    frequency: "MONTHLY",
  },
  VOID_SPACE: {
    label: "Void Space",
    frequency: "EVERY_DD",
  },
  CARGO_TANK: {
    label: "Cargo Tank",
    frequency: "AS_NEEDED",
  },
  BALLAST_TANK: {
    label: "Ballast Tank",
    frequency: "EVERY_DD",
  },
};

export const INSPECTION_AREA_OPTIONS = [
  { value: "CARGO_HOLD", label: "Cargo Hold" },
  { value: "MAIN_DECK", label: "Main Deck" },
  { value: "VOID_SPACE", label: "Void Space" },
  { value: "CARGO_TANK", label: "Cargo Tank" },
  { value: "BALLAST_TANK", label: "Ballast Tank" },
] as const;

export function getInspectionAreaLabel(areaType: string | null | undefined) {
  if (!areaType) return "Unknown";
  return INSPECTION_AREA_CONFIG[areaType as InspectionAreaType]?.label || areaType;
}

export function getInspectionAreaFrequency(areaType: string | null | undefined) {
  if (!areaType) return "";
  return INSPECTION_AREA_CONFIG[areaType as InspectionAreaType]?.frequency || "";
}