"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getActiveVessels, type VesselRow } from "@/lib/rustDb";
import { type ReportRow } from "@/lib/reportDb";
import { getInspectionAreaLabel } from "@/lib/inspectionAreaConfig";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://rust-fleet-tool-api.onrender.com";

const AREA_OPTIONS = [
  "CARGO_HOLD",
  "MAIN_DECK",
  "VOID_SPACE",
  "BALLAST_TANK",
  "CARGO_TANK",
] as const;

type ApprovedPhotoRow = {
  id: string;
  session_id: string | null;
  vessel_id: string;
  area_type: string;
  location_tag: string | null;
  image_path: string | null;
  created_at: string;
};

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function areaBadgeColor(area: string) {
  switch (area) {
    case "CARGO_HOLD":
      return "#7c3aed";
    case "MAIN_DECK":
      return "#0f766e";
    case "VOID_SPACE":
      return "#2563eb";
    case "BALLAST_TANK":
      return "#b45309";
    case "CARGO_TANK":
      return "#be123c";
    default:
      return "#475569";
  }
}

function cleanLocationTag(tag: string | null | undefined) {
  if (!tag) return "-";
  return String(tag)
    .replace(/\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function getPhotoUrl(path: string | null | undefined) {
  if (!path) return "";

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const { data } = supabaseBrowser().storage.from("rust-photos").getPublicUrl(path);
  return data?.publicUrl || "";
}

function normalizeArea(value: string) {
  return value.toUpperCase().replace(/\s+/g, "_");
}

function cardStyle(): React.CSSProperties {
  return {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
  };
}

export default function ReportsPage() {
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [vesselId, setVesselId] = useState("");
  const [areaType, setAreaType] = useState<string>("CARGO_HOLD");

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [approvedRows, setApprovedRows] = useState<ApprovedPhotoRow[]>([]);

  const [busy, setBusy] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingApproved, setLoadingApproved] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const rows = await getActiveVessels();
        setVessels(rows || []);
        if (rows?.length) setVesselId(rows[0].id);
      } catch (e: any) {
        setMsg(e?.message || String(e));
      }
    })();
  }, []);

  const selectedVessel = useMemo(
    () => vessels.find((v) => v.id === vesselId) || null,
    [vessels, vesselId]
  );

  const filteredReports = useMemo(() => reports, [reports]);

  async function loadReportHistory() {
    try {
      if (!selectedVessel?.id || !areaType) {
        setReports([]);
        return;
      }

      setLoadingReports(true);

      const normalizedArea = normalizeArea(areaType);

      const { data, error } = await supabaseBrowser()
        .from("reports")
        .select("*")
        .eq("vessel_id", selectedVessel.id)
        .eq("area_type", normalizedArea)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setReports((data || []) as ReportRow[]);
    } catch (e: any) {
      console.error("loadReportHistory error:", e);
      setMsg(e?.message || String(e));
      setReports([]);
    } finally {
      setLoadingReports(false);
    }
  }

  async function loadApprovedPreview() {
    try {
      if (!selectedVessel?.id || !areaType) {
        setApprovedRows([]);
        return;
      }

      setLoadingApproved(true);

      const normalizedArea = normalizeArea(areaType);

      const { data, error } = await supabaseBrowser()
        .from("inspection_reviews")
        .select(`
          photo_id,
          review_status,
          reviewed_at,
          inspection_photos!inspection_reviews_photo_id_fkey (
            id,
            session_id,
            vessel_id,
            area_type,
            location_tag,
            image_path,
            created_at
          )
        `)
        .eq("review_status", "APPROVED")
        .eq("inspection_photos.vessel_id", selectedVessel.id)
        .eq("inspection_photos.area_type", normalizedArea)
        .order("reviewed_at", { ascending: false });

      if (error) throw error;

      const rows: ApprovedPhotoRow[] = (data || [])
        .map((row: any) => {
          const photo = Array.isArray(row.inspection_photos)
            ? row.inspection_photos[0]
            : row.inspection_photos;

          if (!photo) return null;

          return {
            id: photo.id,
            session_id: photo.session_id ?? null,
            vessel_id: photo.vessel_id,
            area_type: photo.area_type,
            location_tag: photo.location_tag ?? null,
            image_path: photo.image_path ?? null,
            created_at: photo.created_at,
          };
        })
        .filter(Boolean) as ApprovedPhotoRow[];

      setApprovedRows(rows);
    } catch (e: any) {
      console.error("Approved preview load error:", e);
      setMsg(e?.message || String(e));
      setApprovedRows([]);
    } finally {
      setLoadingApproved(false);
    }
  }

  useEffect(() => {
    if (selectedVessel && areaType) {
      loadReportHistory();
    } else {
      setReports([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVessel, areaType]);

  useEffect(() => {
    if (selectedVessel && areaType) {
      loadApprovedPreview();
    } else {
      setApprovedRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVessel, areaType]);

  async function generateReport() {
    try {
      if (!selectedVessel) {
        setMsg("Please select a vessel.");
        return;
      }

      if (!approvedRows || approvedRows.length === 0) {
        setMsg("No approved photos available for report generation.");
        return;
      }

      setBusy(true);
      setMsg("Generating report...");

      const {
        data: { user },
      } = await supabaseBrowser().auth.getUser();

      const normalizedArea = normalizeArea(areaType);

      const summary = {
        vessel: selectedVessel.name,
        area: normalizedArea,
        approved_count: approvedRows.length,
        generated_at: new Date().toISOString(),
      };

      const photos = approvedRows.map((r) => ({
        location_tag: cleanLocationTag(r.location_tag),
        rust_pct_total: 0,
        image_url: getPhotoUrl(r.image_path),
      }));

      const formData = new FormData();
      formData.append("vessel_name", selectedVessel.name);
      formData.append("vessel_id", selectedVessel.id);
      formData.append("area", normalizedArea);
      formData.append("created_by", user?.id || "");
      formData.append("summary_json", JSON.stringify(summary));
      formData.append("photos_json", JSON.stringify(photos));

      const res = await fetch(`${API_BASE}/report/vessel`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "Report generation failed");
      }

      setMsg(`✅ Report generated successfully (${approvedRows.length} photos)`);
      await loadReportHistory();
    } catch (e: any) {
      console.error("Report error:", e);
      setMsg(`❌ ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openReport(row: any) {
    try {
      const path = row.file_path || row.report_path;

      if (!path) {
        alert("Report path not found.");
        return;
      }

      const cleanPath = String(path).replace(/^\/+/, "");
      const url = `${API_BASE}/open-report?path=${encodeURIComponent(cleanPath)}`;
      window.open(url, "_blank");
    } catch (err) {
      console.error(err);
      alert("Failed to open report");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 35%, #f8fafc 100%)",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 24,
            padding: 20,
            boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 150,
                height: 58,
                borderRadius: 14,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                padding: "6px 10px",
                border: "1px solid #e2e8f0",
              }}
            >
              <img
                src="/company-logo.png"
                alt="Company Logo"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>
                Rust Inspection Reports
              </div>
              <div style={{ marginTop: 4, color: "#475569", fontSize: 14 }}>
                Professional reporting screen for vessel corrosion review, approval, and PDF generation
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1d4ed8",
              fontWeight: 700,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            Ready for Local Testing
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 0.9fr auto",
            gap: 14,
            marginTop: 20,
          }}
        >
          <div style={{ ...cardStyle(), padding: 16 }}>
            <label style={{ fontWeight: 700, color: "#0f172a" }}>Vessel</label>
            <select
              value={vesselId}
              onChange={(e) => setVesselId(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                marginTop: 8,
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#0f172a",
              }}
            >
              <option value="">All Vessels</option>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} {"code" in v && (v as any).code ? `(${(v as any).code})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ ...cardStyle(), padding: 16 }}>
            <label style={{ fontWeight: 700, color: "#0f172a" }}>Area Type</label>
            <select
              value={areaType}
              onChange={(e) => setAreaType(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                marginTop: 8,
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#0f172a",
              }}
            >
              {AREA_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {getInspectionAreaLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              ...cardStyle(),
              padding: 16,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 13, color: "#64748b" }}>Selected Area</div>
            <div
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                width: "fit-content",
                padding: "8px 12px",
                borderRadius: 999,
                background: `${areaBadgeColor(areaType)}15`,
                color: areaBadgeColor(areaType),
                border: `1px solid ${areaBadgeColor(areaType)}33`,
                fontWeight: 800,
              }}
            >
              {getInspectionAreaLabel(areaType)}
            </div>
          </div>

          <div
            style={{
              ...cardStyle(),
              padding: 16,
              display: "flex",
              alignItems: "end",
            }}
          >
            <button
              onClick={generateReport}
              disabled={busy || !selectedVessel}
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: 14,
                border: "none",
                background: busy
                  ? "#94a3b8"
                  : "linear-gradient(90deg, #0f172a 0%, #2563eb 100%)",
                color: "#fff",
                fontWeight: 800,
                cursor: busy || !selectedVessel ? "not-allowed" : "pointer",
                boxShadow: "0 10px 20px rgba(37, 99, 235, 0.25)",
              }}
            >
              {busy ? "Generating..." : "Generate PDF Report"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 0.9fr",
            gap: 16,
            marginTop: 20,
            alignItems: "start",
          }}
        >
          <div style={cardStyle()}>
            <div
              style={{
                padding: 18,
                borderBottom: "1px solid #eef2f7",
                background: "#f8fbff",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                Approved Photos Preview
              </div>
              <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                Vessel: <b>{selectedVessel?.name || "-"}</b> | Area: <b>{getInspectionAreaLabel(areaType)}</b>
              </div>
            </div>

            <div style={{ padding: 18 }}>
              {loadingApproved ? (
                <div style={{ color: "#64748b" }}>Loading approved photos...</div>
              ) : approvedRows.length === 0 ? (
                <div style={{ color: "#64748b" }}>
                  No approved photos found for the selected vessel and area.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            borderBottom: "1px solid #e5e7eb",
                            width: 52,
                          }}
                        >
                          #
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            borderBottom: "1px solid #e5e7eb",
                            width: 150,
                          }}
                        >
                          Image
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Location
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            borderBottom: "1px solid #e5e7eb",
                            width: 190,
                          }}
                        >
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedRows.map((r, i) => {
                        const imageUrl = getPhotoUrl(r.image_path);

                        return (
                          <tr key={r.id}>
                            <td
                              style={{
                                padding: 10,
                                borderBottom: "1px solid #f1f5f9",
                                verticalAlign: "top",
                              }}
                            >
                              {i + 1}
                            </td>

                            <td
                              style={{
                                padding: 10,
                                borderBottom: "1px solid #f1f5f9",
                                verticalAlign: "top",
                              }}
                            >
                              {imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt={cleanLocationTag(r.location_tag) || `approved-${i + 1}`}
                                  style={{
                                    width: 120,
                                    height: 90,
                                    objectFit: "cover",
                                    borderRadius: 8,
                                    border: "1px solid #dbe3ee",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => window.open(imageUrl, "_blank")}
                                />
                              ) : (
                                <span style={{ color: "#94a3b8" }}>No image</span>
                              )}
                            </td>

                            <td
                              style={{
                                padding: 10,
                                borderBottom: "1px solid #f1f5f9",
                                verticalAlign: "top",
                              }}
                            >
                              {cleanLocationTag(r.location_tag)}
                            </td>

                            <td
                              style={{
                                padding: 10,
                                borderBottom: "1px solid #f1f5f9",
                                verticalAlign: "top",
                              }}
                            >
                              {fmtDate(r.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div style={cardStyle()}>
              <div
                style={{
                  padding: 18,
                  borderBottom: "1px solid #eef2f7",
                  background: "#f8fbff",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  Report Generation Notes
                </div>
              </div>

              <div style={{ padding: 18, lineHeight: 1.75, color: "#334155", fontSize: 14 }}>
                <div>The report will be generated using:</div>
                <div style={{ marginTop: 10 }}>
                  <div>• only approved photos</div>
                  <div>• selected vessel</div>
                  <div>• selected area type</div>
                  <div>• pictorial corrosion maps where applicable</div>
                  <div>• detailed photo pages</div>
                </div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  padding: 18,
                  borderBottom: "1px solid #eef2f7",
                  background: "#f8fbff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  Report History
                </div>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  {filteredReports.length} record(s)
                </div>
              </div>

              <div style={{ padding: 18 }}>
                {loadingReports ? (
                  <div style={{ color: "#64748b" }}>Loading report history...</div>
                ) : filteredReports.length === 0 ? (
                  <div style={{ color: "#64748b" }}>
                    No reports found for the selected vessel and area.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              width: 48,
                            }}
                          >
                            #
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              width: 120,
                            }}
                          >
                            Area
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              width: 110,
                            }}
                          >
                            Type
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              width: 180,
                            }}
                          >
                            Created
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                            }}
                          >
                            File
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              width: 110,
                            }}
                          >
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReports.map((r, i) => (
                          <tr key={r.id}>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              {i + 1}
                            </td>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  padding: "8px 12px",
                                  borderRadius: 999,
                                  background: `${areaBadgeColor(r.area_type || areaType)}15`,
                                  color: areaBadgeColor(r.area_type || areaType),
                                  border: `1px solid ${areaBadgeColor(r.area_type || areaType)}33`,
                                  fontWeight: 800,
                                }}
                              >
                                {getInspectionAreaLabel((r.area_type as any) || areaType)}
                              </span>
                            </td>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              {r.report_type || "-"}
                            </td>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              {fmtDate(r.created_at)}
                            </td>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              {r.file_name || "-"}
                            </td>
                            <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                              <button
                                onClick={() => openReport(r)}
                                style={{
                                  padding: "8px 16px",
                                  borderRadius: 12,
                                  border: "1px solid #cbd5e1",
                                  background: "#fff",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {msg ? (
          <div
            style={{
              marginTop: 16,
              padding: "14px 16px",
              borderRadius: 16,
              border: msg.startsWith("✅") ? "1px solid #bfdbfe" : "1px solid #fecaca",
              background: msg.startsWith("✅") ? "#eff6ff" : "#fef2f2",
              color: msg.startsWith("✅") ? "#1d4ed8" : "#b91c1c",
              fontWeight: 700,
            }}
          >
            {msg}
          </div>
        ) : null}
      </div>
    </div>
  );
}