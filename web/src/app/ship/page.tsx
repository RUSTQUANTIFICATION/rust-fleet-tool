"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import UploadPage from "../upload/page";
import LogoutButton from "@/components/LogoutButton";
import { getReviewQueue, type ReviewPhotoRow } from "@/lib/reviewDb";

type ShipTab = "upload" | "status" | "guidance";

type AreaType =
  | "CARGO_HOLD"
  | "CARGO_TANK"
  | "BALLAST_TANK"
  | "VOID_SPACE"
  | "MAIN_DECK";

type ProfileRow = {
  id: string;
  role: string | null;
  vessel_id: string | null;
  full_name: string | null;
};

type VesselRow = {
  id: string;
  name: string;
  code?: string | null;
};

type SessionRow = {
  id: string;
  vessel_id: string;
  area_type: AreaType;
  created_at: string | null;
};

type PhotoRow = {
  id: string;
  session_id: string;
};

type FindingRow = {
  photo_id: string;
  rust_pct_total: number | null;
};

type AreaStatus = {
  areaType: AreaType;
  areaLabel: string;
  lastSubmitted: string | null;
  rustPct: number | null;
  nextDue: string;
  frequencyText: string;
};

const AREA_CONFIG: Array<{
  areaType: AreaType;
  areaLabel: string;
  frequencyText: string;
}> = [
  {
    areaType: "CARGO_HOLD",
    areaLabel: "Cargo Hold",
    frequencyText: "As needed / every 6 months",
  },
  {
    areaType: "CARGO_TANK",
    areaLabel: "Cargo Tank",
    frequencyText: "As needed / every 6 months",
  },
  {
    areaType: "BALLAST_TANK",
    areaLabel: "Ballast Tank",
    frequencyText: "Every DD",
  },
  {
    areaType: "VOID_SPACE",
    areaLabel: "Void Space",
    frequencyText: "Every DD",
  },
  {
    areaType: "MAIN_DECK",
    areaLabel: "Main Deck",
    frequencyText: "Every month",
  },
];

export default function ShipPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [tab, setTab] = useState<ShipTab>("upload");
  const [checkingAccess, setCheckingAccess] = useState(true);

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [selectedVesselId, setSelectedVesselId] = useState("");
  const [vesselLocked, setVesselLocked] = useState(false);
  const [vessel, setVessel] = useState<VesselRow | null>(null);

  const [statusRows, setStatusRows] = useState<AreaStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");

  const [rejectedRows, setRejectedRows] = useState<ReviewPhotoRow[]>([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  const [rejectedError, setRejectedError] = useState("");

  useEffect(() => {
    async function checkAccess() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, role, vessel_id, full_name")
        .eq("id", user.id)
        .single();

      if (!profileData) {
        router.push("/login");
        return;
      }

      const p = profileData as ProfileRow;
      const role = (p.role || "").toLowerCase();

      if (!role.includes("ship") && !role.includes("shore")) {
        router.push("/login");
        return;
      }

      setProfile(p);

      const { data: vesselsData, error: vesselsErr } = await supabase
        .from("vessels")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (vesselsErr) {
        console.error(vesselsErr);
        setCheckingAccess(false);
        return;
      }

      const activeVessels = (vesselsData as VesselRow[]) || [];
      setVessels(activeVessels);

      if (p.vessel_id) {
        setSelectedVesselId(p.vessel_id);
        setVesselLocked(true);

        const matched = activeVessels.find((x) => x.id === p.vessel_id) || null;
        setVessel(matched);
      } else {
        setSelectedVesselId("");
        setVesselLocked(false);
        setVessel(null);
      }

      setCheckingAccess(false);
    }

    checkAccess();
  }, [router, supabase]);

  useEffect(() => {
    if (!selectedVesselId) {
      setVessel(null);
      return;
    }

    const matched = vessels.find((x) => x.id === selectedVesselId) || null;
    setVessel(matched);
  }, [selectedVesselId, vessels]);

  useEffect(() => {
    async function loadSubmissionStatus() {
      if (!selectedVesselId) {
        setStatusRows([]);
        setStatusError("Please select a vessel to view submission status.");
        return;
      }

      try {
        setStatusLoading(true);
        setStatusError("");

        const resultRows: AreaStatus[] = [];

        for (const area of AREA_CONFIG) {
          const { data: sessionData, error: sessionErr } = await supabase
            .from("inspection_sessions")
            .select("id, vessel_id, area_type, created_at")
            .eq("vessel_id", selectedVesselId)
            .eq("area_type", area.areaType)
            .order("created_at", { ascending: false })
            .limit(1);

          if (sessionErr) throw sessionErr;

          const latestSession = (sessionData?.[0] as SessionRow | undefined) || null;

          if (!latestSession) {
            resultRows.push({
              areaType: area.areaType,
              areaLabel: area.areaLabel,
              lastSubmitted: null,
              rustPct: null,
              nextDue: formatDue(area.areaType, null),
              frequencyText: area.frequencyText,
            });
            continue;
          }

          const { data: photoData, error: photoErr } = await supabase
            .from("inspection_photos")
            .select("id, session_id")
            .eq("session_id", latestSession.id);

          if (photoErr) throw photoErr;

          const photos = (photoData as PhotoRow[]) || [];
          const photoIds = photos.map((x) => x.id);

          let rustPct: number | null = null;

          if (photoIds.length > 0) {
            const { data: findingData, error: findingErr } = await supabase
              .from("photo_findings")
              .select("photo_id, rust_pct_total")
              .in("photo_id", photoIds);

            if (findingErr) throw findingErr;

            const findings = ((findingData as FindingRow[]) || []).filter(
              (x) => typeof x.rust_pct_total === "number"
            );

            if (findings.length > 0) {
              const total = findings.reduce((sum, x) => sum + Number(x.rust_pct_total || 0), 0);
              rustPct = total / findings.length;
            }
          }

          resultRows.push({
            areaType: area.areaType,
            areaLabel: area.areaLabel,
            lastSubmitted: latestSession.created_at,
            rustPct,
            nextDue: formatDue(area.areaType, latestSession.created_at),
            frequencyText: area.frequencyText,
          });
        }

        setStatusRows(resultRows);
      } catch (e: any) {
        console.error(e);
        setStatusError(e?.message || String(e));
      } finally {
        setStatusLoading(false);
      }
    }

    loadSubmissionStatus();
  }, [selectedVesselId, supabase]);

  useEffect(() => {
    async function loadRejectedItems() {
      if (!selectedVesselId) {
        setRejectedRows([]);
        setRejectedError("Please select a vessel to view rejected photos.");
        return;
      }

      try {
        setRejectedLoading(true);
        setRejectedError("");

        const rows = await getReviewQueue({
          vesselId: selectedVesselId,
          reviewStatus: "REJECTED",
        });

        const onlyReupload = rows.filter((x) => x.reupload_required === true);
        setRejectedRows(onlyReupload);
      } catch (e: any) {
        console.error(e);
        setRejectedError(e?.message || String(e));
      } finally {
        setRejectedLoading(false);
      }
    }

    loadRejectedItems();
  }, [selectedVesselId]);

  if (checkingAccess) {
    return <div style={{ padding: 40, fontWeight: 600 }}>Checking access...</div>;
  }

  const showVesselSelector = !vesselLocked;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Ship Workspace</h1>
        <LogoutButton />
      </div>

      <TopHeader
        title="Ship Inspection Upload"
        subtitle="Single operational sheet for onboard crew"
        badge="SHIP WORKSPACE"
      />

      <div style={{ maxWidth: 1520, margin: "0 auto", padding: "24px 24px 32px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px minmax(0, 1fr)",
            gap: 22,
            alignItems: "start",
          }}
        >
          <aside
            style={{
              background: "#ffffff",
              border: "1px solid #dbe3ee",
              borderRadius: 24,
              padding: 20,
              boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
              height: "fit-content",
              position: "sticky",
              top: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "#64748b", marginBottom: 12 }}>
              NAVIGATION
            </div>

            <SideNavButton
              active={tab === "upload"}
              label="Upload Photos"
              hint="Use the live upload sheet"
              onClick={() => setTab("upload")}
            />
            <SideNavButton
              active={tab === "status"}
              label={`Submission Status${rejectedRows.length > 0 ? ` (${rejectedRows.length} action)` : ""}`}
              hint="Quick onboard status panel"
              onClick={() => setTab("status")}
            />
            <SideNavButton
              active={tab === "guidance"}
              label="Inspection Guidance"
              hint="Checklist and photo guidance"
              onClick={() => setTab("guidance")}
            />
          </aside>

          <main
            style={{
              background: "#ffffff",
              border: "1px solid #dbe3ee",
              borderRadius: 28,
              boxShadow: "0 14px 34px rgba(15,23,42,0.06)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 20 }}>
              {tab === "upload" && (
                <Card title="Live Upload Sheet" subtitle="Connected to your real upload module">
                  {showVesselSelector && (
                    <div style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>Select Vessel</label>
                      <select
                        value={selectedVesselId}
                        onChange={(e) => setSelectedVesselId(e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">Select vessel</option>
                        {vessels.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} {v.code ? `(${v.code})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {rejectedRows.length > 0 && (
                    <div
                      style={{
                        marginBottom: 16,
                        border: "1px solid #fecaca",
                        background: "#fff1f2",
                        color: "#b91c1c",
                        borderRadius: 14,
                        padding: 14,
                        fontWeight: 800,
                      }}
                    >
                      {rejectedRows.length} rejected photo(s) require re-upload. Check Submission Status for details.
                    </div>
                  )}

                  {!selectedVesselId && showVesselSelector ? (
                    <div
                      style={{
                        border: "1px solid #facc15",
                        background: "#fef9c3",
                        color: "#854d0e",
                        borderRadius: 14,
                        padding: 12,
                        fontWeight: 700,
                      }}
                    >
                      Please select a vessel first.
                    </div>
                  ) : (
                    <UploadPage />
                  )}
                </Card>
              )}

              {tab === "status" && (
                <div style={{ display: "grid", gap: 18 }}>
                  <Card
                    title="Submission Status"
                    subtitle={`Vessel-specific latest submission summary${vessel?.name ? ` — ${vessel.name}${vessel?.code ? ` (${vessel.code})` : ""}` : ""}`}
                  >
                    {showVesselSelector && (
                      <div style={{ marginBottom: 16 }}>
                        <label style={labelStyle}>Select Vessel</label>
                        <select
                          value={selectedVesselId}
                          onChange={(e) => setSelectedVesselId(e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">Select vessel</option>
                          {vessels.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} {v.code ? `(${v.code})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {!selectedVesselId ? (
                      <div
                        style={{
                          border: "1px solid #facc15",
                          background: "#fef9c3",
                          color: "#854d0e",
                          borderRadius: 14,
                          padding: 12,
                          fontWeight: 700,
                        }}
                      >
                        Please select a vessel to view submission status.
                      </div>
                    ) : statusLoading ? (
                      <div style={{ padding: "8px 2px", color: "#475569", fontWeight: 700 }}>
                        Loading...
                      </div>
                    ) : statusError ? (
                      <div
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#b91c1c",
                          borderRadius: 14,
                          padding: 12,
                          fontWeight: 700,
                        }}
                      >
                        {statusError}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 14 }}>
                        {statusRows.map((row) => (
                          <div
                            key={row.areaType}
                            style={{
                              border: "1px solid #e5e7eb",
                              borderRadius: 18,
                              background: "#fff",
                              padding: 16,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 20,
                                fontWeight: 900,
                                color: areaCardColor(row.areaType),
                                marginBottom: 12,
                              }}
                            >
                              {row.areaLabel}
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(4, minmax(180px, 1fr))",
                                gap: 12,
                              }}
                            >
                              <SmallStat label="Last Submitted" value={formatDateTime(row.lastSubmitted)} />
                              <SmallStat
                                label="Rust %"
                                value={row.rustPct !== null ? `${row.rustPct.toFixed(2)}%` : "-"}
                              />
                              <SmallStat label="Next Due" value={row.nextDue} />
                              <SmallStat label="Frequency" value={row.frequencyText} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card
                    title="Rejected Photos – Re-upload Required"
                    subtitle="These photos were rejected by reviewer and replacement upload is required"
                  >
                    {!selectedVesselId ? (
                      <div
                        style={{
                          border: "1px solid #facc15",
                          background: "#fef9c3",
                          color: "#854d0e",
                          borderRadius: 14,
                          padding: 12,
                          fontWeight: 700,
                        }}
                      >
                        Please select a vessel to view rejected photos.
                      </div>
                    ) : rejectedLoading ? (
                      <div style={{ padding: "8px 2px", color: "#475569", fontWeight: 700 }}>
                        Loading...
                      </div>
                    ) : rejectedError ? (
                      <div
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#b91c1c",
                          borderRadius: 14,
                          padding: 12,
                          fontWeight: 700,
                        }}
                      >
                        {rejectedError}
                      </div>
                    ) : rejectedRows.length === 0 ? (
                      <div
                        style={{
                          border: "1px solid #dcfce7",
                          background: "#f0fdf4",
                          color: "#166534",
                          borderRadius: 14,
                          padding: 12,
                          fontWeight: 700,
                        }}
                      >
                        No rejected photos pending re-upload.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div
                          style={{
                            border: "1px solid #fecaca",
                            background: "#fff1f2",
                            color: "#b91c1c",
                            borderRadius: 14,
                            padding: 12,
                            fontWeight: 800,
                          }}
                        >
                          Action required: upload replacement photos for the items listed below.
                        </div>

                        {rejectedRows.map((row) => (
                          <div
                            key={row.photo_id}
                            style={{
                              border: "1px solid #e5e7eb",
                              borderRadius: 18,
                              background: "#fff",
                              padding: 16,
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(6, minmax(140px, 1fr))",
                                gap: 12,
                              }}
                            >
                              <SmallStat label="Area" value={humanizeArea(row.area_type)} />
                              <SmallStat label="Location" value={row.location_tag || "-"} />
                              <SmallStat
                                label="Rust %"
                                value={typeof row.rust_pct_total === "number" ? `${row.rust_pct_total.toFixed(2)}%` : "-"}
                              />
                              <SmallStat label="Rejected On" value={formatDateTime(row.reviewed_at)} />
                              <SmallStat label="Reviewer" value={row.reviewer_name || "-"} />
                              <SmallStat label="Status" value="RE-UPLOAD REQUIRED" valueColor="#b91c1c" />
                            </div>

                            <div
                              style={{
                                marginTop: 12,
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 12,
                              }}
                            >
                              <TextBox
                                label="Reject Reason"
                                value={row.reject_reason || "No reject reason entered"}
                                bg="#fff7ed"
                                color="#9a3412"
                              />
                              <TextBox
                                label="Reviewer Notes"
                                value={row.review_notes || "No reviewer notes entered"}
                                bg="#f8fafc"
                                color="#334155"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              )}

              {tab === "guidance" && (
                <div style={{ display: "grid", gap: 20 }}>
                  <Card title="Photo Requirements" subtitle="Mandatory rules for all uploads">
                    <div style={{ lineHeight: 1.9, color: "#334155" }}>
                      <div>• Use clear, focused images (no blur / no zoom distortion).</div>
                      <div>• Avoid glare, shadows, and backlight.</div>
                      <div>• Ensure rust area is clearly visible and centered.</div>
                      <div>• Maintain consistent distance (~1–2 meters).</div>
                      <div>• Take photos perpendicular to surface (no angle).</div>
                      <div>• Minimum resolution: <b>1280 × 720</b></div>
                      <div>• Recommended size: <b>0.5MB – 5MB</b></div>
                      <div>• Allowed formats: <b>JPG / PNG</b></div>
                    </div>
                  </Card>

                  <Card title="Area-wise Inspection Requirements" subtitle="Follow exact coverage rules">
                    <div style={{ lineHeight: 1.9, color: "#334155" }}>
                      <div><b>Cargo Hold:</b> 11 fixed positions per hold</div>
                      <div>• Forward bulkhead</div>
                      <div>• Aft bulkhead</div>
                      <div>• Port & Starboard bulkheads</div>
                      <div>• Tank top (floor)</div>
                      <div>• Hatch coaming (all sides)</div>

                      <div style={{ marginTop: 10 }}>
                        <b>Main Deck:</b> 20 photos (forward → aft, evenly spaced)
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <b>Cargo Tank:</b> Minimum 6 key corrosion areas
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <b>Ballast Tank / Void Space:</b> 5 representative corrosion areas
                      </div>
                    </div>
                  </Card>

                  <Card title="Inspection Frequency" subtitle="Mandatory submission intervals">
                    <div style={{ lineHeight: 1.9, color: "#334155" }}>
                      <div>• Cargo Hold: As needed / every 6 months</div>
                      <div>• Cargo Tank: As needed / every 6 months</div>
                      <div>• Ballast Tank: Every Dry Dock (DD)</div>
                      <div>• Void Space: Every Dry Dock (DD)</div>
                      <div>• Main Deck: Every month</div>
                    </div>
                  </Card>

                  <Card title="Cargo Hold – Photo Positions" subtitle="Standard 11 inspection locations">
                    <div style={{ marginBottom: 10, color: "#475569" }}>
                      Use this reference to capture all required areas.
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <img
                        src="/cargo-hold-guide.png"
                        alt="Cargo Hold Layout"
                        style={{
                          maxWidth: "100%",
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                        }}
                      />
                    </div>
                  </Card>

                  <Card title="Main Deck – Coverage Plan" subtitle="Forward to aft sequence">
                    <div style={{ marginBottom: 10, color: "#475569" }}>
                      Take evenly spaced photos along deck length.
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <img
                        src="/main-deck-guide.png"
                        alt="Main Deck Layout"
                        style={{
                          maxWidth: "100%",
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                        }}
                      />
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatDue(areaType: AreaType, lastSubmitted: string | null) {
  if (!lastSubmitted) {
    if (areaType === "BALLAST_TANK" || areaType === "VOID_SPACE") return "Next DD";
    return "Now";
  }

  if (areaType === "MAIN_DECK") {
    return addMonths(lastSubmitted, 1).toLocaleDateString();
  }

  if (areaType === "CARGO_HOLD" || areaType === "CARGO_TANK") {
    return `${addMonths(lastSubmitted, 6).toLocaleDateString()} / As needed`;
  }

  if (areaType === "BALLAST_TANK" || areaType === "VOID_SPACE") {
    return "Next DD";
  }

  return "-";
}

function areaCardColor(areaType: AreaType) {
  if (areaType === "MAIN_DECK") return "#2563eb";
  if (areaType === "CARGO_HOLD") return "#ea580c";
  if (areaType === "CARGO_TANK") return "#7c3aed";
  if (areaType === "BALLAST_TANK") return "#0f766e";
  return "#475569";
}

function humanizeArea(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function TopHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle: string;
  badge: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
        color: "#fff",
        padding: "18px 24px",
        boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              padding: 6,
            }}
          >
            <img
              src="/company-logo.png"
              alt="Company Logo"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{title}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.86)", fontSize: 14 }}>
              {subtitle}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.18)",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {badge}
        </div>
      </div>
    </div>
  );
}

function SideNavButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 14,
        borderRadius: 16,
        border: active ? "2px solid #1d4ed8" : "1px solid #e2e8f0",
        background: active ? "#eff6ff" : "#fff",
        marginBottom: 10,
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, color: "#0f172a" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{hint}</div>
    </button>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 24,
        padding: 18,
        boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{title}</div>
      <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{subtitle}</div>
      <div style={{ marginTop: 16 }}>{children}</div>
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
        borderRadius: 14,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 20,
          fontWeight: 900,
          color: valueColor || "#0f172a",
          lineHeight: 1.25,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TextBox({
  label,
  value,
  bg,
  color,
}: {
  label: string;
  value: string;
  bg: string;
  color: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 14,
        background: bg,
      }}
    >
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 15,
          fontWeight: 700,
          color,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

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