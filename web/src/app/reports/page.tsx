"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getActiveVessels, type VesselRow } from "@/lib/rustDb";
import { type ReportRow } from "@/lib/reportDb";
import { getInspectionAreaLabel } from "@/lib/inspectionAreaConfig";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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
  return String(tag).replace(/\.(jpg|jpeg|png|webp)$/i, "").replace(/_/g, " ");
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
        setVessels(rows);
        if (rows.length) setVesselId(rows[0].id);
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

      const normalizedArea = areaType.toUpperCase().replace(/\s+/g, "_");

      console.log("=== DEBUG REPORT FILTER ===");
      console.log("Selected Vessel:", selectedVessel);
      console.log("Selected Vessel ID:", selectedVessel.id);
      console.log("Area Type (UI):", areaType);
      console.log("Area Type (Normalized):", normalizedArea);

      const { data, error } = await supabaseBrowser()
        .from("reports")
        .select("*")
        .eq("vessel_id", selectedVessel.id)
        .eq("area_type", normalizedArea)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      console.log("Fetched Reports:", data);

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
    if (!selectedVessel) {
      setApprovedRows([]);
      return;
    }

    setLoadingApproved(true);

    const normalizedArea = areaType.toUpperCase().replace(/\s+/g, "_");

    const { data, error } = await supabaseBrowser()
      .from("inspection_reviews")
      .select(`
        photo_id,
        review_status,
        reviewed_at,
        inspection_photos!inner (
          id,
          session_id,
          vessel_id,
          area_type,
          location_tag,
          file_path,
          created_at
        )
      `)
      .eq("review_status", "APPROVED")
      .eq("inspection_photos.vessel_id", selectedVessel.id)
      .eq("inspection_photos.area_type", normalizedArea)
      .order("reviewed_at", { ascending: false });

    if (error) {
      throw error;
    }

    const rows: ApprovedPhotoRow[] = (data || []).map((row: any) => ({
      id: row.inspection_photos.id,
      session_id: row.inspection_photos.session_id ?? null,
      vessel_id: row.inspection_photos.vessel_id,
      area_type: row.inspection_photos.area_type,
      location_tag: row.inspection_photos.location_tag ?? null,
      image_path: row.inspection_photos.file_path ?? null,
      created_at: row.inspection_photos.created_at,
    }));

    setApprovedRows(rows);
  } catch (e: any) {
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
  }, [selectedVessel, areaType]);

  useEffect(() => {
    if (selectedVessel) {
      loadApprovedPreview();
    }
  }, [selectedVessel, areaType]);

  async function generateReport() {
    try {
      if (!selectedVessel) {
        setMsg("Please select a vessel.");
        return;
      }

      setBusy(true);
      setMsg("Generating report...");

      const formData = new FormData();
      formData.append("vessel_name", selectedVessel.name);
      formData.append("area_type", areaType);

      const {
        data: { user },
      } = await supabaseBrowser().auth.getUser();

      if (!user?.id) {
        throw new Error("User not logged in.");
      }

      formData.append("created_by", user.id);

      const res = await fetch(`${API_BASE}/generate-report`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "Report generation failed");
      }

      setMsg(`✅ Report generated successfully. Approved photos used: ${data?.approved_count ?? 0}`);
      await loadReportHistory();

      if (data?.report_signed_url) {
        window.open(data.report_signed_url, "_blank");
      }
    } catch (e: any) {
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

      // Open in new tab
      window.open(url, "_blank");

    } catch (err) {
      alert("Failed to open report");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #f8fafc 0%, #eef2ff 35%, #f8fafc 100%)",
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
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: 16,
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
            }}
          >
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

          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: 16,
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
            }}
          >
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
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: 16,
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
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
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: 16,
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
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
                border: "1px solid #0f172a",
                background: busy
                  ? "#cbd5e1"
                  : "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
                color: "#fff",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
                boxShadow: busy ? "none" : "0 8px 20px rgba(29, 78, 216, 0.25)",
              }}
            >
              {busy ? "Generating..." : selectedVessel ? "Generate PDF Report" : "Select Vessel to Generate"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 16,
            marginTop: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
            }}
          >
            <div
              style={{
                padding: 16,
                borderBottom: "1px solid #eef2f7",
                background: "linear-gradient(90deg, #f8fafc 0%, #eef2ff 100%)",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                Approved Photos Preview
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
                Vessel: <b>{selectedVessel?.name || "-"}</b> | Area:{" "}
                <b>{getInspectionAreaLabel(areaType)}</b>
              </div>
            </div>

            <div style={{ padding: 16 }}>
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
                      <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                        <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>#</th>
                        <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Location</th>
                        <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedRows.map((r, i) => (
                        <tr key={r.id}>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{i + 1}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                            {cleanLocationTag(r.location_tag)}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                            {fmtDate(r.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
            }}
          >
            <div
              style={{
                padding: 16,
                borderBottom: "1px solid #eef2f7",
                background: "linear-gradient(90deg, #f8fafc 0%, #eef2ff 100%)",
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

              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 16,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ fontWeight: 700, color: "#0f172a" }}>Cargo Hold Mapping</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#64748b" }}>
                  Real tags such as <code>hold1_fwd_bulkhead</code> are auto-mapped into the
                  11 cargo hold schematic positions.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 20,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
          }}
        >
          <div
            style={{
              padding: 16,
              borderBottom: "1px solid #eef2f7",
              background: "linear-gradient(90deg, #f8fafc 0%, #eef2ff 100%)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Report History
            </div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {loadingReports ? "Loading..." : `${filteredReports.length} record(s)`}
            </div>

          </div>

          {loadingReports ? (
            <div style={{ padding: 16, color: "#64748b" }}>Loading reports...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                    <th style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>Area</th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>Type</th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>Created</th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>File</th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: `${areaBadgeColor(r.area_type || "")}15`,
                            color: areaBadgeColor(r.area_type || ""),
                            fontWeight: 700,
                            fontSize: 12,
                            border: `1px solid ${areaBadgeColor(r.area_type || "")}33`,
                          }}
                        >
                          {r.area_type ? getInspectionAreaLabel(r.area_type) : "-"}
                        </span>
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                        {r.report_type}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                        {fmtDate(r.created_at)}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", color: "#64748b" }}>
                        {((r as any).file_path || r.report_path || "-")
                          .split("/")
                          .pop()}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                        <button
                          onClick={() => openReport(r)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            color: "#0f172a",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredReports.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16, color: "#64748b" }}>
                        No reports found for the selected vessel and area.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {msg && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 18,
              border: "1px solid #dbeafe",
              background: "#eff6ff",
              color: "#1e3a8a",
              whiteSpace: "pre-wrap",
              fontWeight: 600,
            }}
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}