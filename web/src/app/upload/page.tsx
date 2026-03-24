"use client";

import React, { useEffect, useMemo, useState } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  ACCEPTED_MIME,
  CARGO_HOLD_LOCATIONS,
  labelizeLocation,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
} from "@/lib/inspectionConfig";
import { getUploadRule, type AreaType } from "@/lib/uploadRules";
import {
  createInspectionSession,
  getActiveVessels,
  insertInspectionPhoto,
  insertPhotoFindings,
  safeSlug,
  uploadToStorage,
  type VesselRow,
} from "@/lib/rustDb";

const PHOTOS_BUCKET = "rust-photos";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

type UploadMode = "DIRECT_PHOTOS" | "SOURCE_FILE";
type SourceType = "IMAGE_BATCH" | "EXCEL" | "WORD" | "PDF";

type UploadItem = {
  file: File;
  localId: string;
  location_tag: string;
  dhash?: string;
  isDuplicate?: boolean;
  dupOf?: string;
};

type VesselSubmissionStatus = {
  vesselName: string;
  areaType: AreaType;
  latestSessionId: string | null;
  latestSessionAt: string | null;
  uploadedCount: number;
  minimumRequired: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "MINIMUM_MET";
};

type ShipProfile = {
  id: string;
  role: string | null;
  vessel_id: string | null;
  full_name: string | null;
};

const AREA_OPTIONS: Array<{
  value: AreaType;
  label: string;
}> = [
  { value: "CARGO_HOLD", label: "Cargo Hold" },
  { value: "MAIN_DECK", label: "Main Deck" },
  { value: "VOID_SPACE", label: "Void Space" },
  { value: "CARGO_TANK", label: "Cargo Tank" },
  { value: "BALLAST_TANK", label: "Ballast Tank" },
];

function parseRoles(role: string | null | undefined) {
  return new Set(
    String(role || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function isShipOnlyRole(role: string | null | undefined) {
  const roles = parseRoles(role);
  return roles.has("ship") && !roles.has("shore") && !roles.has("admin");
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function getAreaLabel(areaType: AreaType) {
  return AREA_OPTIONS.find((x) => x.value === areaType)?.label || areaType;
}

function humanizeTag(tag: string) {
  return tag.replaceAll("_", " ");
}

function getSourceAccept(sourceType: SourceType) {
  if (sourceType === "IMAGE_BATCH") return "image/*";
  if (sourceType === "EXCEL") {
    return ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12";
  }
  if (sourceType === "WORD") {
    return ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return ".pdf,application/pdf";
}

async function fileToDHash(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;

  const bmp = await createImageBitmap(file);
  const w = 9;
  const h = 8;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;

  const gray: number[] = [];
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i];
    const g = img[i + 1];
    const b = img[i + 2];
    gray.push((r + g + b) / 3);
  }

  let bits = "";
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w - 1; col++) {
      const a = gray[row * w + col];
      const b = gray[row * w + col + 1];
      bits += a > b ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    const nibble = bits.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  return hex;
}

function hammingHex(a: string, b: string) {
  if (a.length !== b.length) return 999;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += x.toString(2).split("1").length - 1;
  }
  return dist;
}

export default function UploadPage() {
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [vesselId, setVesselId] = useState<string>("");

  const [areaType, setAreaType] = useState<AreaType>("CARGO_HOLD");

  const [uploadMode, setUploadMode] = useState<UploadMode>("DIRECT_PHOTOS");
  const [sourceType, setSourceType] = useState<SourceType>("IMAGE_BATCH");
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const [holdNo, setHoldNo] = useState<number>(1);
  const [spaceNo, setSpaceNo] = useState<string>("1");

  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const [apiResults, setApiResults] = useState<any[]>([]);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [bypassMinimum, setBypassMinimum] = useState(false);
  const [profile, setProfile] = useState<ShipProfile | null>(null);
  const [shipLockedVessel, setShipLockedVessel] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<VesselSubmissionStatus | null>(null);

  const supabase = supabaseBrowser();
  const uploadRule = useMemo(() => getUploadRule(areaType), [areaType]);

  useEffect(() => {
    async function lockShipVessel() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("role, vessel_id")
        .eq("id", user.id)
        .single();

      const role = String(data?.role || "").toLowerCase();

      if (role === "ship" && data?.vessel_id) {
        setVesselId(data.vessel_id);
        setShipLockedVessel(true);
      }
    }

    lockShipVessel();
  }, [supabase]);

  async function analyzeUploadedPhoto(args: {
    photoId: string;
    storagePath: string;
    areaType: string;
    locationTag: string | null;
  }) {
    const form = new FormData();
    form.append("photo_id", args.photoId);
    form.append("storage_path", args.storagePath);
    form.append("area_type", args.areaType);
    if (args.locationTag) form.append("location_tag", args.locationTag);

    const res = await fetch(`${API_BASE}/analyze-photo`, {
      method: "POST",
      body: form,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail || "Photo analysis failed");
    }

    return data;
  }

  async function loadInitialData() {
    try {
      const sb = supabaseBrowser();

      const { data: authData, error: authError } = await sb.auth.getUser();
      if (authError) throw authError;

      const userId = authData?.user?.id;
      if (!userId) {
        setLog("User not logged in.");
        return;
      }

      const { data: profileData, error: profileError } = await sb
        .from("profiles")
        .select("id,role,vessel_id,full_name")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) throw profileError;

      const p = (profileData as ShipProfile | null) || null;
      setProfile(p);

      const allVessels = await getActiveVessels();

      if (isShipOnlyRole(p?.role) && p?.vessel_id) {
        const assigned = allVessels.filter((v) => v.id === p.vessel_id);
        setVessels(assigned);
        setVesselId(p.vessel_id);
        setShipLockedVessel(true);
      } else {
        setVessels(allVessels);
        setVesselId(allVessels[0]?.id || "");
        setShipLockedVessel(false);
      }
    } catch (e: any) {
      console.error("Initial load failed:", e);
      setLog(String(e?.message || e));
    }
  }

  async function loadSubmissionStatus(nextVesselId: string, nextAreaType: AreaType) {
    try {
      if (!nextVesselId) {
        setSubmissionStatus(null);
        return;
      }

      const sb = supabaseBrowser();
      const vessel = vessels.find((v) => v.id === nextVesselId);

      const { data: sessionRows, error: sessionErr } = await sb
        .from("inspection_sessions")
        .select("id,created_at")
        .eq("vessel_id", nextVesselId)
        .eq("area_type", nextAreaType)
        .order("created_at", { ascending: false })
        .limit(1);

      if (sessionErr) throw sessionErr;

      const latest = sessionRows?.[0];
      if (!latest) {
        setSubmissionStatus({
          vesselName: vessel?.name || "Selected Vessel",
          areaType: nextAreaType,
          latestSessionId: null,
          latestSessionAt: null,
          uploadedCount: 0,
          minimumRequired: getUploadRule(nextAreaType).minPhotos,
          status: "NOT_STARTED",
        });
        return;
      }

      const { count, error: photoErr } = await sb
        .from("inspection_photos")
        .select("*", { count: "exact", head: true })
        .eq("session_id", latest.id);

      if (photoErr) throw photoErr;

      const uploadedCount = count || 0;
      const status =
        uploadedCount >= getUploadRule(nextAreaType).minPhotos ? "MINIMUM_MET" : "IN_PROGRESS";

      setSubmissionStatus({
        vesselName: vessel?.name || "Selected Vessel",
        areaType: nextAreaType,
        latestSessionId: latest.id,
        latestSessionAt: latest.created_at || null,
        uploadedCount,
        minimumRequired: getUploadRule(nextAreaType).minPhotos,
        status,
      });
    } catch (e) {
      console.error("Submission status load failed:", e);
      setSubmissionStatus(null);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (vessels.length && vesselId) {
      loadSubmissionStatus(vesselId, areaType);
    }
  }, [vessels, vesselId, areaType]);

  const checklist = useMemo(() => {
    if (areaType === "MAIN_DECK") {
      const requiredTags = Array.from({ length: 20 }).map(
        (_, i) => `main_deck_${String(i + 1).padStart(2, "0")}`
      );

      return {
        title: "Main Deck Checklist",
        requiredTotal: 20,
        requiredTags,
        guidance: "Upload on monthly basis, 20 photos forward to aft.",
      };
    }

    if (areaType === "VOID_SPACE") {
      const requiredTags = Array.from({ length: 5 }).map(
        (_, i) => `void_space_${spaceNo}_${String(i + 1).padStart(2, "0")}`
      );

      return {
        title: `Void Space Checklist (${spaceNo})`,
        requiredTotal: 5,
        requiredTags,
        guidance: "Every DD, 5 photos per void space rust areas.",
      };
    }

    if (areaType === "BALLAST_TANK") {
      const requiredTags = Array.from({ length: 5 }).map(
        (_, i) => `ballast_tank_${spaceNo}_${String(i + 1).padStart(2, "0")}`
      );

      return {
        title: `Ballast Tank Checklist (${spaceNo})`,
        requiredTotal: 5,
        requiredTags,
        guidance: "Every dry dock, 5 photos per ballast tank rust areas.",
      };
    }

    if (areaType === "CARGO_TANK") {
      const requiredTags = Array.from({ length: 6 }).map(
        (_, i) => `cargo_tank_${spaceNo}_${String(i + 1).padStart(2, "0")}`
      );

      return {
        title: `Cargo Tank Checklist (${spaceNo})`,
        requiredTotal: 6,
        requiredTags,
        guidance: "6 photos per cargo tank, as and when needed and every DD.",
      };
    }

    const requiredTags = CARGO_HOLD_LOCATIONS.map((loc) => `hold${holdNo}_${loc}`);
    return {
      title: `Cargo Hold Checklist (Hold ${holdNo})`,
      requiredTotal: 11,
      requiredTags,
      guidance: "As and when needed, 11 photos per cargo hold.",
    };
  }, [areaType, holdNo, spaceNo]);

  const tagOptions = useMemo(() => checklist.requiredTags, [checklist]);

  function resetFiles() {
    setItems([]);
    setLog("");
    setApiResults([]);
    setSourceFile(null);
    setBypassMinimum(false);
    setProgressPct(0);
    setProgressLabel("");
  }

  function validateFileBasics(file: File): string | null {
    if (!ACCEPTED_MIME.has(file.type)) return `Not allowed type: ${file.type} (${file.name})`;
    if (file.size > MAX_FILE_BYTES) return `File > ${MAX_FILE_MB}MB: ${file.name}`;
    return null;
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList) return;

    const arr = Array.from(fileList);
    const errors: string[] = [];

    for (const f of arr) {
      const err = validateFileBasics(f);
      if (err) errors.push(err);
    }

    if (errors.length) {
      setLog(errors.join("\n"));
      return;
    }

    const startIndex = items.length;
    const newItems: UploadItem[] = [];

    for (let i = 0; i < arr.length; i++) {
      const tag = tagOptions[(startIndex + i) % tagOptions.length] || "unassigned";
      newItems.push({
        file: arr[i],
        localId: uid(),
        location_tag: tag,
      });
    }

    const merged = [...items, ...newItems];

    for (const it of merged) {
      if (!it.dhash) {
        it.dhash = await fileToDHash(it.file);
      }
    }

    for (let i = 0; i < merged.length; i++) {
      merged[i].isDuplicate = false;
      merged[i].dupOf = undefined;

      const ha = merged[i].dhash;
      if (!ha) continue;

      for (let j = 0; j < i; j++) {
        const hb = merged[j].dhash;
        if (!hb) continue;

        const d = hammingHex(ha, hb);
        if (d <= 6) {
          merged[i].isDuplicate = true;
          merged[i].dupOf = merged[j].localId;
          break;
        }
      }
    }

    setItems([...merged]);
    setLog("");
  }

  function setTag(localId: string, tag: string) {
    setItems((prev) => prev.map((x) => (x.localId === localId ? { ...x, location_tag: tag } : x)));
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((x) => x.localId !== localId));
  }

  const checklistStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of checklist.requiredTags) map.set(t, 0);

    for (const it of items) {
      if (map.has(it.location_tag)) {
        map.set(it.location_tag, (map.get(it.location_tag) || 0) + 1);
      }
    }

    const missing: string[] = [];
    for (const [tag, count] of map.entries()) {
      if (count < 1) missing.push(tag);
    }

    const imageCount = items.filter((x) => x.file.type.startsWith("image/")).length;
    const pass = imageCount >= checklist.requiredTotal && missing.length === 0;

    return {
      pass,
      missing,
      imageCount,
      requiredTotal: checklist.requiredTotal,
    };
  }, [items, checklist]);

  async function runDirectUpload() {
    if (!vesselId) {
      setLog("Please select a vessel.");
      return;
    }

    if (!items.length) {
      setLog("Please add files first.");
      return;
    }

    if (!checklistStatus.pass && !bypassMinimum) {
      setLog(
        "Minimum photo checklist not completed.\n\nMissing:\n" +
          checklistStatus.missing.map((m) => `- ${m}`).join("\n") +
          "\n\nTick the bypass checkbox if you still want to proceed."
      );
      return;
    }

    setBusy(true);
    setLog("Creating inspection session...");
    setApiResults([]);
    setProgressPct(5);
    setProgressLabel("Creating inspection session...");

    try {
      const session = await createInspectionSession({
        vessel_id: vesselId,
        area_type: areaType,
        hold_no: areaType === "CARGO_HOLD" ? holdNo : null,
        tank_type:
          areaType === "VOID_SPACE"
            ? "VOID_SPACE"
            : areaType === "BALLAST_TANK"
            ? "BALLAST_TANK"
            : areaType === "CARGO_TANK"
            ? "CARGO_TANK"
            : null,
        tank_no:
          areaType === "VOID_SPACE" || areaType === "BALLAST_TANK" || areaType === "CARGO_TANK"
            ? spaceNo
            : null,
        notes: bypassMinimum ? "MINIMUM_CHECKLIST_BYPASSED" : null,
      });

      setLog((prev) => `${prev ? prev + "\n" : ""}Session created: ${session.id}`);
      setLog((prev) => `${prev ? prev + "\n" : ""}Uploading ${items.length} file(s)...`);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const ext = it.file.name.split(".").pop() || "bin";

        const vessel = vessels.find((v) => v.id === vesselId);
        const vesselSlug = safeSlug(vessel?.name || "vessel");

        const folder = `${vesselSlug}/${session.id}`;
        const path = `${folder}/${it.location_tag}_${i + 1}_${it.localId}.${ext}`;

        setLog((prev) => `${prev ? prev + "\n" : ""}Uploading (${i + 1}/${items.length}): ${it.file.name}`);
        setProgressPct(Math.min(90, 10 + Math.round(((i + 0.25) / items.length) * 70)));
        setProgressLabel(`Uploading ${i + 1} of ${items.length}...`);

        await uploadToStorage({
          bucket: PHOTOS_BUCKET,
          path,
          file: it.file,
          upsert: true,
        });

        const photo = await insertInspectionPhoto({
          session_id: session.id,
          vessel_id: vesselId,
          area_type: areaType,
          location_tag: it.location_tag,
          file_path: path,
          file_name: it.file.name,
          mime_type: it.file.type,
          file_size: it.file.size,
        });

        await insertPhotoFindings({
          photo_id: photo.id,
          rust_pct_total: 0,
          rust_pct_light: 0,
          rust_pct_moderate: 0,
          rust_pct_heavy: 0,
          confidence: null,
          warnings: "ANALYSIS_PENDING",
          phash: it.dhash || null,
          is_duplicate: it.isDuplicate || false,
          dup_group_id: it.dupOf || null,
        });

        setLog((prev) => `${prev ? prev + "\n" : ""}Analyzing (${i + 1}/${items.length}): ${it.file.name}`);

        let analysis: any = null;

        try {
          analysis = await analyzeUploadedPhoto({
            photoId: photo.id,
            storagePath: path,
            areaType,
            locationTag: it.location_tag || null,
          });

          if (analysis && typeof analysis === "object") {
            setApiResults((prev) => [...prev, analysis]);
          }

          setLog(
            (prev) =>
              `${prev ? prev + "\n" : ""}Uploaded + analyzed (${i + 1}/${items.length}): ${it.file.name}\nRust %: ${Number(
                analysis?.rust_pct_total ?? analysis?.rust_pct ?? 0
              ).toFixed(2)}`
          );
        } catch (err: any) {
          setLog(
            (prev) =>
              `${prev ? prev + "\n" : ""}⚠ Analysis failed for (${i + 1}/${items.length}): ${it.file.name}\nReason: ${
                err?.message || String(err)
              }`
          );
        }
      }

      setProgressPct(100);
      setProgressLabel("Upload and analysis completed.");
      setLog((prev) => `${prev ? prev + "\n" : ""}✅ Upload complete and analysis finished.`);
      setItems([]);
      await loadSubmissionStatus(vesselId, areaType);
    } catch (e: any) {
      console.error("UPLOAD FLOW ERROR", e);
      setLog(`❌ Error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setProgressPct(0);
        setProgressLabel("");
      }, 1200);
    }
  }

  console.log("API_BASE =", API_BASE);
  console.log("Posting to =", `${API_BASE}/ingest-source-file`);

  async function runSourceFileUpload() {
    if (!vesselId) {
      setLog("Please select a vessel.");
      return;
    }

    if (!sourceFile) {
      setLog("Please choose a source file first.");
      return;
    }

    setBusy(true);
    setLog("Sending source file for extraction and analysis...");
    setApiResults([]);
    setProgressPct(10);
    setProgressLabel("Uploading source file...");

    try {
      const formData = new FormData();
      formData.append("file", sourceFile);
      formData.append("vessel_id", vesselId);
      formData.append("area_type", areaType);
      formData.append("hold_no", String(holdNo));
      formData.append("space_no", spaceNo);
      formData.append("source_type", sourceType);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        throw new Error("User not logged in.");
      }

      formData.append("created_by", user.id);

      setProgressPct(30);
      setProgressLabel("Source file uploaded. Processing extraction...");

      const res = await fetch(`${API_BASE}/ingest-source-file`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data = await res.json();

      setProgressPct(90);
      setProgressLabel("Finalizing extracted results...");

      setApiResults(
        Array.isArray(data?.results)
          ? data.results.filter((r) => r && typeof r === "object")
          : []
      );

      setProgressPct(100);
      setProgressLabel("Source file processing completed.");
      setLog("✅ Source file processed successfully.");
      await loadSubmissionStatus(vesselId, areaType);
    } catch (e: any) {
      console.error("SOURCE FILE FLOW ERROR", e);
      setLog(`❌ Source file processing error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setProgressPct(0);
        setProgressLabel("");
      }, 1200);
    }
  }

  async function runUpload() {
    if (uploadMode === "DIRECT_PHOTOS") {
      await runDirectUpload();
      return;
    }
    await runSourceFileUpload();
  }

  const selectedVessel = vessels.find((v) => v.id === vesselId);

  return (
    <div style={{ padding: 24, maxWidth: 1320, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", margin: 0 }}>
        Ship Photo Upload
      </h1>
      <p
        style={{
          opacity: 0.82,
          marginTop: 10,
          fontSize: 15,
          lineHeight: 1.6,
          color: "#475569",
          maxWidth: 920,
        }}
      >
        Upload inspection photos with minimum checklist guidance, area frequency, vessel-bound submission
        control, and live submission status tracking.
      </p>

      {busy && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #dbe3ee",
            borderRadius: 16,
            background: "#ffffff",
            padding: 14,
            boxShadow: "0 8px 20px rgba(15,23,42,0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 800, color: "#0f172a" }}>
              {progressLabel || "Processing..."}
            </div>
            <div style={{ fontWeight: 800, color: "#2563eb" }}>{progressPct}%</div>
          </div>

          <div
            style={{
              height: 12,
              background: "#e5e7eb",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)",
                transition: "width 0.35s ease",
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        <div style={cardStyle}>
          <label style={labelStyle}>Vessel</label>
          <select
            value={vesselId}
            onChange={(e) => setVesselId(e.target.value)}
            style={inputStyle}
            disabled={shipLockedVessel}
          >
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {"code" in v && v.code ? `(${v.code})` : ""}
              </option>
            ))}
          </select>
          {shipLockedVessel && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#2563eb", fontWeight: 700 }}>
              Ship login detected. Vessel is locked to assigned ship.
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <label style={labelStyle}>Area Type</label>
          <select
            value={areaType}
            onChange={(e) => {
              setAreaType(e.target.value as AreaType);
              resetFiles();
            }}
            style={inputStyle}
          >
            {AREA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={cardStyle}>
          <label style={labelStyle}>Upload Mode</label>
          <select
            value={uploadMode}
            onChange={(e) => {
              setUploadMode(e.target.value as UploadMode);
              resetFiles();
            }}
            style={inputStyle}
          >
            <option value="DIRECT_PHOTOS">Direct Photos</option>
            <option value="SOURCE_FILE">Excel / Word / PDF / Image Batch</option>
          </select>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Frequency</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{uploadRule.frequency}</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.82 }}>{uploadRule.guidance}</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {areaType === "CARGO_HOLD" && (
          <div style={inlineBox}>
            <label style={labelStyle}>Hold No</label>
            <input
              type="number"
              min={1}
              value={holdNo}
              onChange={(e) => {
                setHoldNo(Number(e.target.value || 1));
                resetFiles();
              }}
              style={{ ...inputStyle, width: 120 }}
            />
          </div>
        )}

        {(areaType === "VOID_SPACE" || areaType === "BALLAST_TANK" || areaType === "CARGO_TANK") && (
          <div style={inlineBox}>
            <label style={labelStyle}>
              {areaType === "VOID_SPACE"
                ? "Void Space No"
                : areaType === "BALLAST_TANK"
                ? "Ballast Tank No"
                : "Cargo Tank No"}
            </label>
            <input
              value={spaceNo}
              onChange={(e) => {
                setSpaceNo(e.target.value);
                resetFiles();
              }}
              style={{ ...inputStyle, width: 140 }}
            />
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 0.95fr)",
          gap: 18,
          marginTop: 18,
          alignItems: "start",
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{checklist.title}</div>
          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.82 }}>{checklist.guidance}</div>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(120px,1fr))",
              gap: 10,
            }}
          >
            <SmallStat label="Required Minimum" value={String(checklist.requiredTotal)} />
            <SmallStat label="Selected Photos" value={String(checklistStatus.imageCount)} />
            <SmallStat
              label="Checklist Status"
              value={checklistStatus.pass ? "READY" : "BELOW MINIMUM"}
              valueColor={checklistStatus.pass ? "#15803d" : "#b91c1c"}
            />
          </div>

          {!checklistStatus.pass && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Missing checklist items</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {checklistStatus.missing.map((m) => (
                  <span key={m} style={missingChip}>
                    {areaType === "CARGO_HOLD" ? humanizeTag(m) : m}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontWeight: 700,
            }}
          >
            <input
              type="checkbox"
              checked={bypassMinimum}
              onChange={(e) => setBypassMinimum(e.target.checked)}
            />
            Proceed with fewer photos and submit anyway
          </label>

          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            This bypass allows upload with fewer than the minimum required photos.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Vessel Submission Status</div>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(140px,1fr))",
              gap: 10,
            }}
          >
            <SmallStat label="Vessel" value={selectedVessel?.name || "-"} />
            <SmallStat label="Area" value={getAreaLabel(areaType)} />
            <SmallStat
              label="Last Session"
              value={
                submissionStatus?.latestSessionAt
                  ? new Date(submissionStatus.latestSessionAt).toLocaleString()
                  : "Not Started"
              }
            />
            <SmallStat
              label="Status"
              value={submissionStatus?.status || "NOT_STARTED"}
              valueColor={
                submissionStatus?.status === "MINIMUM_MET"
                  ? "#15803d"
                  : submissionStatus?.status === "IN_PROGRESS"
                  ? "#d97706"
                  : "#6b7280"
              }
            />
            <SmallStat
              label="Uploaded Count"
              value={`${submissionStatus?.uploadedCount || 0} / ${uploadRule.minPhotos}`}
            />
            <SmallStat
              label="Login"
              value={profile?.role === "ship" ? "Ship User" : "General User"}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Inspection Guidance</div>
          <div style={{ fontSize: 14, opacity: 0.82 }}>
            {uploadRule.frequency} — {uploadRule.guidance}
          </div>
        </div>
      </div>

      {uploadMode === "DIRECT_PHOTOS" ? (
        <>
          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
              padding: "16px 18px",
              border: "1px solid #e2e8f0",
              borderRadius: 18,
              background: "#f8fafc",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontWeight: 800,
                fontSize: 14,
                color: "#0f172a",
                cursor: "pointer",
                minHeight: 48,
                boxShadow: "0 4px 12px rgba(15,23,42,0.04)",
              }}
            >
              <span>Choose Files</span>
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => onPickFiles(e.target.files)}
                style={{ display: "none" }}
              />
            </label>

            <div
              style={{
                minWidth: 260,
                fontSize: 13,
                color: "#475569",
                fontWeight: 700,
              }}
            >
              {items.length > 0 ? `${items.length} file(s) selected` : "No files selected"}
            </div>

            <button onClick={resetFiles} style={ghostButton}>
              Clear
            </button>

            <button onClick={runUpload} disabled={busy} style={primaryUploadButton}>
              {busy ? "Uploading..." : "⬆ Upload Photos"}
            </button>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <div style={cardStyle}>
              <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 18 }}>Files ({items.length})</div>

              {items.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No files added yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={thStyle}>File</th>
                        <th style={thStyle}>Size</th>
                        <th style={thStyle}>Tag</th>
                        <th style={thStyle}>Duplicate?</th>
                        <th style={thStyle}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.localId}>
                          <td style={tdStyle}>{it.file.name}</td>
                          <td style={tdStyle}>{(it.file.size / (1024 * 1024)).toFixed(2)} MB</td>
                          <td style={tdStyle}>
                            <select
                              value={it.location_tag}
                              onChange={(e) => setTag(it.localId, e.target.value)}
                              style={{ ...inputStyle, padding: 8 }}
                            >
                              {tagOptions.map((t) => (
                                <option key={t} value={t}>
                                  {areaType === "CARGO_HOLD" ? humanizeTag(t) : t}
                                </option>
                              ))}
                              <option value="unassigned">unassigned</option>
                            </select>
                          </td>
                          <td style={tdStyle}>
                            {it.isDuplicate ? (
                              <span style={{ color: "crimson", fontWeight: 700 }}>YES</span>
                            ) : (
                              <span style={{ color: "green", fontWeight: 700 }}>NO</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <button onClick={() => removeItem(it.localId)} style={ghostButtonSmall}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {areaType === "CARGO_HOLD" && (
                    <div style={{ marginTop: 12, fontSize: 12, opacity: 0.82 }}>
                      Cargo hold numbering:
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {CARGO_HOLD_LOCATIONS.map((k) => (
                          <span key={k} style={guideTagChip}>
                            {labelizeLocation(String(k))}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {apiResults.length > 0 && (
              <div style={cardStyle}>
                <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 18 }}>
                  Analysis Status ({apiResults.length})
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {apiResults
                    .filter((r) => r && typeof r === "object")
                    .map((r, idx) => {
                      const rustPct =
                        typeof r?.rust_pct_total === "number"
                          ? r.rust_pct_total.toFixed(2)
                          : typeof r?.rust_pct === "number"
                          ? r.rust_pct.toFixed(2)
                          : "-";

                      const status =
                        r?.updated_row?.overall_severity ||
                        r?.severity ||
                        r?.analysis_status ||
                        "DONE";

                      return (
                        <div
                          key={idx}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            padding: "10px 12px",
                            background: "#fff",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            Photo {idx + 1}
                          </div>

                          <div style={{ fontWeight: 700, color: "#334155" }}>
                            {status}
                          </div>

                          <div style={{ fontWeight: 800, color: "#0f172a" }}>
                            Rust: {rustPct}%
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept={getSourceAccept(sourceType)}
              onChange={(e) => {
                setSourceFile(e.target.files?.[0] || null);
                setApiResults([]);
                setLog("");
              }}
            />
            <button onClick={resetFiles} style={ghostButton}>
              Clear
            </button>
            <button onClick={runUpload} disabled={busy} style={primaryUploadButton}>
              {busy ? "Processing..." : "⬆ Upload Photos"}
            </button>
          </div>

          <div style={{ marginTop: 12, ...cardStyle }}>
            <div style={{ fontWeight: 800 }}>Selected Source File</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              {sourceFile
                ? `${sourceFile.name} (${(sourceFile.size / (1024 * 1024)).toFixed(2)} MB)`
                : "No source file selected."}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Source file mode skips direct pre-count validation because extracted image count is only known after processing.
            </div>
          </div>

          {apiResults.length > 0 && (
            <div style={{ marginTop: 14, ...cardStyle }}>
              <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 18 }}>
                Extracted / Analyzed Results ({apiResults.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={thStyle}>Image</th>
                      <th style={thStyle}>Rust %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiResults
                      .filter((r) => r && typeof r === "object")
                      .map((r, idx) => (
                        <tr key={idx}>
                          <td style={tdStyle}>{r.image || r.image_name || `Image ${idx + 1}`}</td>
                          <td style={tdStyle}>
                            {typeof r.rust_pct === "number" ? r.rust_pct.toFixed(2) : r.rust_pct ?? "-"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {log && (
        <pre
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid #eee",
            borderRadius: 12,
            background: "#0b0b0b",
            color: "#d7ffd7",
            whiteSpace: "pre-wrap",
          }}
        >
          {log}
        </pre>
      )}
    </div>
  );
}

function SmallStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.72 }}>{label}</div>
      <div
        style={{
          marginTop: 6,
          fontWeight: 800,
          fontSize: 18,
          color: valueColor || "#111827",
          lineHeight: 1.2,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #dbe3ee",
  borderRadius: 20,
  background: "#ffffff",
  padding: 18,
  boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 800,
  marginBottom: 8,
  fontSize: 13,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #cfd8e3",
  background: "#fff",
  fontSize: 15,
  boxSizing: "border-box",
  minHeight: 48,
  color: "#0f172a",
};

const inlineBox: React.CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "center",
  flexWrap: "wrap",
};

const primaryUploadButton: React.CSSProperties = {
  padding: "13px 22px",
  borderRadius: 14,
  border: "1px solid #1d4ed8",
  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  color: "#fff",
  fontWeight: 900,
  fontSize: 15,
  cursor: "pointer",
  boxShadow: "0 10px 20px rgba(37,99,235,0.24)",
  minHeight: 48,
  minWidth: 160,
};

const ghostButton: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid #cfd8e3",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  minHeight: 48,
  fontSize: 14,
};

const ghostButtonSmall: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#334155",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 8px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 14,
  color: "#0f172a",
};

const missingChip: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#b91c1c",
  borderRadius: 999,
  padding: "6px 11px",
  fontSize: 12,
  fontWeight: 800,
};

const guideTagChip: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fafafa",
  borderRadius: 999,
  padding: "6px 11px",
  fontSize: 12,
};