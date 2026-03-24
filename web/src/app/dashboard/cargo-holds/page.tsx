"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type VesselRow = {
  id: string;
  name: string;
};

type SessionRow = {
  id: string;
  vessel_id: string;
  area_type: string;
  area_name: string;
  created_at: string;
};

type PhotoRow = {
  id: string;
  session_id: string;
  vessel_id: string;
  area_type: string;
  location_tag: string | null;
  image_path: string | null;
  created_at: string;
};

type FindingRow = {
  photo_id: string;
  rust_pct: number;
};

type SummaryRow = {
  vessel_id: string;
  vessel_name: string;
  key: string;
  hold: string;
  location: string;
  count: number;
  avg: number;
  max: number;
};

export default function CargoHoldsDashboardPage() {
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [vesselId, setVesselId] = useState("");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setErr("");
      const sb = supabaseBrowser();

      // 1) Load vessels
      const { data: vesselsData, error: vesselsError } = await sb
        .from("vessels")
        .select("id,name")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (vesselsError) throw vesselsError;
      const vesselRows = (vesselsData || []) as VesselRow[];
      setVessels(vesselRows);

      // 2) Load cargo hold sessions
      const { data: sessionsData, error: sessionsError } = await sb
        .from("inspection_sessions")
        .select("id,vessel_id,area_type,area_name,created_at")
        .eq("area_type", "CARGO_HOLD")
        .order("created_at", { ascending: false });

      if (sessionsError) throw sessionsError;

      // 3) Load cargo hold photos
      const { data: photosData, error: photosError } = await sb
        .from("inspection_photos")
        .select("id,session_id,vessel_id,area_type,location_tag,image_path,created_at")
        .eq("area_type", "CARGO_HOLD")
        .order("created_at", { ascending: false });

      if (photosError) throw photosError;

      // 4) Load findings
      const { data: findingsData, error: findingsError } = await sb
        .from("photo_findings")
        .select("photo_id,rust_pct");

      if (findingsError) throw findingsError;

      const sessions = (sessionsData || []) as SessionRow[];
      const photos = (photosData || []) as PhotoRow[];
      const findings = (findingsData || []) as FindingRow[];

      const sessionMap = new Map<string, SessionRow>();
      sessions.forEach((s) => sessionMap.set(s.id, s));

      const rustMap = new Map<string, number>();
      findings.forEach((f) => rustMap.set(f.photo_id, Number(f.rust_pct || 0)));

      const vesselMap = new Map<string, string>();
      vesselRows.forEach((v) => vesselMap.set(v.id, v.name));

      const grouped = new Map<string, SummaryRow>();

      for (const p of photos) {
        const s = sessionMap.get(p.session_id);
        if (!s) continue;

        const thisVesselId = p.vessel_id;
        const vesselName = vesselMap.get(thisVesselId) || "Unknown Vessel";
        const hold = s.area_name || "Hold";
        const location = p.location_tag || "(no tag)";
        const rust = rustMap.get(p.id) ?? 0;

        // IMPORTANT: vessel included in grouping key
        const key = `${thisVesselId}__${hold}__${location}`;

        const row = grouped.get(key) || {
          vessel_id: thisVesselId,
          vessel_name: vesselName,
          key,
          hold,
          location,
          count: 0,
          avg: 0,
          max: 0,
        };

        row.count += 1;
        row.avg += rust;
        row.max = Math.max(row.max, rust);

        grouped.set(key, row);
      }

      const result = Array.from(grouped.values()).map((r) => ({
        ...r,
        avg: Number((r.avg / r.count).toFixed(2)),
        max: Number(r.max.toFixed(2)),
      }));

      result.sort((a, b) => b.max - a.max);
      setSummary(result);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || String(e));
    }
  }

  const filteredSummary = useMemo(() => {
    if (!vesselId) return summary;
    return summary.filter((r) => r.vessel_id === vesselId);
  }, [summary, vesselId]);

  return (
    <div style={{ padding: 18, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Cargo Holds Dashboard</h1>
      <p style={{ opacity: 0.8 }}>Top locations by rust %.</p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
        <label style={{ fontWeight: 700 }}>Vessel</label>
        <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} style={{ padding: 8 }}>
          <option value="">(All vessels)</option>
          {vessels.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {err && (
        <pre style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
          {err}
        </pre>
      )}

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#fafafa" }}>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Vessel</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Hold | Location</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Photos</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Avg Rust %</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>Max Rust %</th>
            </tr>
          </thead>
          <tbody>
            {filteredSummary.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.vessel_name}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                  {r.hold} | {r.location}
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.count}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.avg}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{r.max}</td>
              </tr>
            ))}
            {filteredSummary.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                  No cargo hold data for the selected vessel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}