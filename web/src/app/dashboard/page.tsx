"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getActiveVessels, type VesselRow } from "@/lib/rustDb";
import { getAutoVesselDashboard, type VesselDashboardRow, type VesselOverallRow } from "@/lib/dashboardDb";
import { getInspectionAreaLabel } from "@/lib/inspectionAreaConfig";

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function rustColor(v: number) {
  if (v >= 15) return "#b91c1c";
  if (v >= 8) return "#dc2626";
  if (v >= 3) return "#d97706";
  return "#15803d";
}

export default function DashboardPage() {
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [vesselId, setVesselId] = useState("");
  const [vesselRows, setVesselRows] = useState<VesselOverallRow[]>([]);
  const [areaRows, setAreaRows] = useState<VesselDashboardRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await getActiveVessels();
        setVessels(v);
      } catch (e: any) {
        setMsg(e?.message || String(e));
      }
    })();
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMsg("");
      const data = await getAutoVesselDashboard(vesselId || undefined);
      setVesselRows(data.vesselRows);
      setAreaRows(data.areaRows);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselId]);

  const topStats = useMemo(() => {
    const totalPhotos = vesselRows.reduce((sum, r) => sum + r.total_photos, 0);
    const worstMax = vesselRows.length ? Math.max(...vesselRows.map((r) => r.overall_max_rust_pct)) : 0;
    const avgFleet =
      vesselRows.length > 0
        ? Number(
            (
              vesselRows.reduce((sum, r) => sum + r.overall_avg_rust_pct, 0) /
              vesselRows.length
            ).toFixed(2)
          )
        : 0;
    const latest =
      vesselRows
        .map((r) => r.latest_inspection_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;

    return {
      totalPhotos,
      worstMax,
      avgFleet,
      latest,
    };
  }, [vesselRows]);

  return (
    <div style={{ padding: 18, maxWidth: 1250 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Auto Vessel Corrosion Dashboard</h1>
      <p style={{ opacity: 0.8 }}>
        Auto-generated from uploaded inspection photos and rust analysis findings.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px auto",
          gap: 12,
          alignItems: "end",
          marginTop: 16,
        }}
      >
        <div>
          <label style={{ fontWeight: 700 }}>Vessel</label>
          <select
            value={vesselId}
            onChange={(e) => setVesselId(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 6 }}
          >
            <option value="">(All vessels)</option>
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            onClick={loadDashboard}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
            }}
          >
            {loading ? "Refreshing..." : "Refresh Dashboard"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 12,
          marginTop: 16,
        }}
      >
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Total Photos</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{topStats.totalPhotos}</div>
        </div>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Fleet Avg Rust %</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: rustColor(topStats.avgFleet) }}>
            {topStats.avgFleet.toFixed(2)}
          </div>
        </div>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Worst Rust %</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: rustColor(topStats.worstMax) }}>
            {topStats.worstMax.toFixed(2)}
          </div>
        </div>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Latest Inspection</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtDate(topStats.latest)}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 16,
          marginTop: 18,
        }}
      >
        <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 12, fontWeight: 800, borderBottom: "1px solid #eee" }}>
            Vessel Overall Summary
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#fafafa" }}>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Vessel</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Photos</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Avg Rust %</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Max Rust %</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Latest Inspection</th>
                </tr>
              </thead>
              <tbody>
                {vesselRows.map((r) => (
                  <tr key={r.vessel_id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.vessel_name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.total_photos}</td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f2f2f2",
                        fontWeight: 700,
                        color: rustColor(r.overall_avg_rust_pct),
                      }}
                    >
                      {r.overall_avg_rust_pct.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f2f2f2",
                        fontWeight: 700,
                        color: rustColor(r.overall_max_rust_pct),
                      }}
                    >
                      {r.overall_max_rust_pct.toFixed(2)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      {fmtDate(r.latest_inspection_at)}
                    </td>
                  </tr>
                ))}

                {vesselRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                      No vessel summary data found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 12, fontWeight: 800, borderBottom: "1px solid #eee" }}>
            Area Corrosion Ranking
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#fafafa" }}>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Vessel</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Area</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Photos</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Avg Rust %</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Max Rust %</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>High/Severe Count</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Latest Inspection</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((r, idx) => (
                  <tr key={`${r.vessel_id}_${r.area_type}_${idx}`}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.vessel_name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      {getInspectionAreaLabel(r.area_type)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.photo_count}</td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f2f2f2",
                        fontWeight: 700,
                        color: rustColor(r.avg_rust_pct),
                      }}
                    >
                      {r.avg_rust_pct.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f2f2f2",
                        fontWeight: 700,
                        color: rustColor(r.max_rust_pct),
                      }}
                    >
                      {r.max_rust_pct.toFixed(2)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.severe_count}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                      {fmtDate(r.latest_inspection_at)}
                    </td>
                  </tr>
                ))}

                {areaRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 12, opacity: 0.7 }}>
                      No area corrosion data found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {msg && (
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
          {msg}
        </pre>
      )}
    </div>
  );
}