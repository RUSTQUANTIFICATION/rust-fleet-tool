export type AreaType =
  | "CARGO_HOLD"
  | "MAIN_DECK"
  | "VOID_SPACE"
  | "CARGO_TANK"
  | "BALLAST_TANK";

export type UploadRule = {
  areaType: AreaType;
  label: string;
  minPhotos: number;
  frequency: string;
  guidance: string;
  checklistMode: "mandatory";
};

export const UPLOAD_RULES: UploadRule[] = [
  {
    areaType: "CARGO_HOLD",
    label: "Cargo Hold",
    minPhotos: 11,
    frequency: "As and when needed",
    guidance: "11 photos per cargo hold",
    checklistMode: "mandatory",
  },
  {
    areaType: "MAIN_DECK",
    label: "Main Deck",
    minPhotos: 20,
    frequency: "Upload on monthly basis",
    guidance: "20 photos forward to aft",
    checklistMode: "mandatory",
  },
  {
    areaType: "BALLAST_TANK",
    label: "Ballast Tank",
    minPhotos: 5,
    frequency: "Every dry dock",
    guidance: "5 photos per ballast tank rust areas",
    checklistMode: "mandatory",
  },
  {
    areaType: "VOID_SPACE",
    label: "Void Space",
    minPhotos: 5,
    frequency: "Every dry dock",
    guidance: "5 photos per void space rust areas",
    checklistMode: "mandatory",
  },
  {
    areaType: "CARGO_TANK",
    label: "Cargo Tank",
    minPhotos: 6,
    frequency: "As and when needed and every dry dock",
    guidance: "6 photos per cargo tank",
    checklistMode: "mandatory",
  },
];

export function getUploadRule(areaType: AreaType) {
  return UPLOAD_RULES.find((x) => x.areaType === areaType)!;
}