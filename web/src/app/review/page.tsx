"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { getActiveVessels, type VesselRow } from "@/lib/rustDb";
import {
  getReviewQueue,
  getSignedImageUrls,
  upsertInspectionReview,
  type ReviewPhotoRow,
  type ReviewStatus,
} from "@/lib/reviewDb";
import { getInspectionAreaLabel } from "@/lib/inspectionAreaConfig";

const REVIEW_OPTIONS: Array<ReviewStatus | "ALL"> = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
];

const DECISION_OPTIONS: ReviewStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
];

const AREA_OPTIONS = [
  "ALL",
  "CARGO_HOLD",
  "MAIN_DECK",
  "VOID_SPACE",
  "BALLAST_TANK",
  "CARGO_TANK",
] as const;

type PreviewUrls = {
  originalUrl: string | null;
  markedUrl: string | null;
  maskUrl: string | null;
};

type ModalImageType = "original" | "marked" | "mask" | null;

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function severityColor(v: string | null | undefined) {
  const x = (v || "").toUpperCase();
  if (x === "SEVERE") return "#b91c1c";
  if (x === "HIGH") return "#dc2626";
  if (x === "MODERATE") return "#d97706";
  if (x === "WATCH") return "#ca8a04";
  if (x === "LOW") return "#15803d";
  return "#6b7280";
}

function reviewColor(v: string | null | undefined) {
  const x = (v || "").toUpperCase();
  if (x === "APPROVED") return "#15803d";
  if (x === "REJECTED") return "#b91c1c";
  if (x === "PENDING") return "#2563eb";
  return "#6b7280";
}

function analysisColor(v: string | null | undefined) {
  const x = (v || "").toUpperCase();
  if (x === "COMPLETED") return "#15803d";
  if (x === "PROCESSING") return "#2563eb";
  if (x === "FAILED") return "#b91c1c";
  if (x === "PENDING") return "#d97706";
  return "#6b7280";
}

function pct(v: number | null | undefined, digits = 2) {
  return Number(v || 0).toFixed(digits);
}

function normalizeReviewStatus(input: string | null | undefined): ReviewStatus {
  const x = String(input || "")
    .trim()
    .toUpperCase();

  if (x === "APPROVED") return "APPROVED";
  if (x === "REJECTED") return "REJECTED";
  return "PENDING";
}

export default function ReviewPage() {
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [vesselId, setVesselId] = useState("");
  const [areaType, setAreaType] = useState<string>("ALL");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | "ALL">("PENDING");

  const [rows, setRows] = useState<ReviewPhotoRow[]>([]);
  const [selected, setSelected] = useState<ReviewPhotoRow | null>(null);

  const [previewUrls, setPreviewUrls] = useState<PreviewUrls>({
    originalUrl: null,
    markedUrl: null,
    maskUrl: null,
  });

  const [reviewerName, setReviewerName] = useState("");
  const [decision, setDecision] = useState<ReviewStatus>("APPROVED");
  const [reviewNotes, setReviewNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [overlayMode, setOverlayMode] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [modalImageType, setModalImageType] = useState<ModalImageType>(null);

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

  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    return rows.findIndex((x) => x.photo_id === selected.photo_id);
  }, [rows, selected]);

  async function loadQueue(preferredPhotoId?: string) {
    try {
      setLoading(true);
      setMsg("");

      const data = await getReviewQueue({
        vesselId: vesselId || undefined,
        areaType,
        reviewStatus,
      });

      setRows(data);

      if (data.length > 0) {
        let keepSelected: ReviewPhotoRow | undefined;

        if (preferredPhotoId) {
          keepSelected = data.find((x) => x.photo_id === preferredPhotoId);
        }

        if (!keepSelected && selected) {
          keepSelected = data.find((x) => x.photo_id === selected.photo_id);
        }

        await selectRow(keepSelected || data[0]);
      } else {
        setSelected(null);
        setPreviewUrls({
          originalUrl: null,
          markedUrl: null,
          maskUrl: null,
        });
      }
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselId, areaType, reviewStatus]);

  async function selectRow(row: ReviewPhotoRow) {
    setSelected(row);
    setDecision(normalizeReviewStatus(row.review_status));
    setReviewerName(row.reviewer_name || "");
    setReviewNotes(row.review_notes || "");
    setRejectReason(row.reject_reason || "");

    const urls = await getSignedImageUrls({
      original_image_path: row.original_image_path,
      marked_image_path: row.marked_image_path,
      mask_image_path: row.mask_image_path,
      image_path: row.image_path,
    });

    setPreviewUrls(urls);
  }

  const goPrev = useCallback(async () => {
    if (selectedIndex <= 0) return;
    await selectRow(rows[selectedIndex - 1]);
  }, [rows, selectedIndex]);

  const goNext = useCallback(async () => {
    if (selectedIndex < 0 || selectedIndex >= rows.length - 1) return;
    await selectRow(rows[selectedIndex + 1]);
  }, [rows, selectedIndex]);

  async function saveReview(forcedDecision?: ReviewStatus) {
    if (!selected) return;

    try {
      setBusy(true);
      setMsg("");

      const currentIndex = rows.findIndex((x) => x.photo_id === selected.photo_id);
      const nextCandidate =
        currentIndex >= 0 && currentIndex < rows.length - 1 ? rows[currentIndex + 1] : null;
      const prevCandidate =
        currentIndex > 0 ? rows[currentIndex - 1] : null;

      const finalDecision = normalizeReviewStatus(forcedDecision || decision);

      await upsertInspectionReview({
        photoId: selected.photo_id,
        reviewStatus: finalDecision,
        reviewerName: reviewerName || null,
        reviewNotes: reviewNotes || null,
        rejectReason: finalDecision === "REJECTED" ? rejectReason || null : null,
      });

      const preferredPhotoId =
        nextCandidate?.photo_id || prevCandidate?.photo_id || undefined;

      if (finalDecision === "REJECTED") {
        setMsg("✅ Saved as REJECTED and returned back to ship for correction.");
      } else {
        setMsg(`✅ Review saved successfully as ${finalDecision}.`);
      }

      await loadQueue(preferredPhotoId);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        !!target?.closest("input, textarea, select");

      if (e.key === "Escape" && modalImageType) {
        setModalImageType(null);
        return;
      }

      if (isTyping) return;
      if (!selected) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        setDecision("APPROVED");
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setDecision("REJECTED");
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setDecision("PENDING");
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveReview();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, modalImageType, goPrev, goNext, decision, reviewerName, reviewNotes, rejectReason]);

  const stats = useMemo(() => {
    const total = rows.length;
    const approved = rows.filter((x) => x.review_status === "APPROVED").length;
    const rejected = rows.filter((x) => x.review_status === "REJECTED").length;
    const pending = rows.filter((x) => !x.review_status || x.review_status === "PENDING").length;
    return { total, approved, rejected, pending };
  }, [rows]);

  const modalTitle =
    modalImageType === "original"
      ? "Original"
      : modalImageType === "marked"
      ? "Marked"
      : modalImageType === "mask"
      ? "Masked"
      : "";

  const modalSrc =
    modalImageType === "original"
      ? previewUrls.originalUrl
      : modalImageType === "marked"
      ? previewUrls.markedUrl
      : modalImageType === "mask"
      ? previewUrls.maskUrl
      : null;

  return (
    <div style={{ padding: 20, maxWidth: 1600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
        Inspection Review / Approval
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 18 }}>
        Review analyzed inspection photos with Original, Marked, and Masked images before approval.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <StatCard title="Total" value={stats.total} color="#111827" />
        <StatCard title="Pending" value={stats.pending} color="#2563eb" />
        <StatCard title="Approved" value={stats.approved} color="#15803d" />
        <StatCard title="Rejected" value={stats.rejected} color="#b91c1c" />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 220px 220px auto",
          gap: 12,
          alignItems: "end",
          marginBottom: 18,
        }}
      >
        <div>
          <label style={labelStyle}>Vessel</label>
          <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} style={inputStyle}>
            <option value="">(All vessels)</option>
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Area Type</label>
          <select value={areaType} onChange={(e) => setAreaType(e.target.value)} style={inputStyle}>
            {AREA_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "ALL" ? "(All areas)" : getInspectionAreaLabel(a)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Review Status</label>
          <select
            value={reviewStatus}
            onChange={(e) => setReviewStatus(e.target.value as ReviewStatus | "ALL")}
            style={inputStyle}
          >
            {REVIEW_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            onClick={() => loadQueue()}
            style={{
              padding: "11px 16px",
              borderRadius: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {loading ? "Loading..." : "Refresh Queue"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Review Queue</div>

          <div style={{ maxHeight: 900, overflowY: "auto" }}>
            {rows.length === 0 ? (
              <div style={{ padding: 16, opacity: 0.7 }}>No photos in the selected review queue.</div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.photo_id}
                  onClick={() => selectRow(row)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    borderBottom: "1px solid #f1f1f1",
                    background: selected?.photo_id === row.photo_id ? "#f8fafc" : "#fff",
                    padding: 14,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{row.vessel_name}</div>
                  <div style={{ fontSize: 13, opacity: 0.85, marginTop: 3 }}>
                    {getInspectionAreaLabel(row.area_type)} | {row.location_tag || "(no tag)"}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 8 }}>
                    Rust %: <b>{pct(row.rust_pct_total || row.rust_pct)}</b>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Severity:{" "}
                    <span style={{ color: severityColor(row.overall_severity), fontWeight: 700 }}>
                      {row.overall_severity || "-"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Review:{" "}
                    <span style={{ color: reviewColor(row.review_status), fontWeight: 700 }}>
                      {normalizeReviewStatus(row.review_status)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Analysis:{" "}
                    <span style={{ color: analysisColor(row.analysis_status), fontWeight: 700 }}>
                      {row.analysis_status || "PENDING"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                    {fmtDate(row.created_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Selected Photo Review</div>

          {!selected ? (
            <div style={{ padding: 18, opacity: 0.7 }}>Select a photo from the queue.</div>
          ) : (
            <div style={{ padding: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={goPrev} disabled={selectedIndex <= 0} style={ghostBtn}>
                    ← Previous
                  </button>
                  <button onClick={goNext} disabled={selectedIndex >= rows.length - 1} style={ghostBtn}>
                    Next →
                  </button>
                  <div style={{ ...hintBox, fontWeight: 700 }}>
                    Shortcuts: ← → A R P S Esc
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={overlayMode}
                      onChange={(e) => setOverlayMode(e.target.checked)}
                    />
                    Compare Original / Marked
                  </label>

                  {overlayMode && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "#555" }}>Overlay</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={overlayOpacity}
                        onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                      />
                      <span style={{ fontSize: 13, minWidth: 38 }}>{overlayOpacity}%</span>
                    </div>
                  )}
                </div>
              </div>

              {overlayMode && previewUrls.originalUrl && previewUrls.markedUrl ? (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>Overlay Compare</div>
                  <div
                    style={{
                      position: "relative",
                      height: 320,
                      border: "1px solid #eee",
                      borderRadius: 14,
                      overflow: "hidden",
                      background: "#fafafa",
                      cursor: "zoom-in",
                    }}
                    onClick={() => setModalImageType("marked")}
                    title="Click to zoom"
                  >
                    <img
                      src={previewUrls.originalUrl}
                      alt="Original compare"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        background: "#fff",
                      }}
                    />
                    <img
                      src={previewUrls.markedUrl}
                      alt="Marked compare"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        background: "transparent",
                        opacity: overlayOpacity / 100,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
                  gap: 16,
                  marginBottom: 18,
                }}
              >
                <ImagePanel
                  title="Original"
                  src={previewUrls.originalUrl}
                  onOpen={() => setModalImageType("original")}
                />
                <ImagePanel
                  title="Marked"
                  src={previewUrls.markedUrl}
                  onOpen={() => setModalImageType("marked")}
                />
                <ImagePanel
                  title="Masked"
                  src={previewUrls.maskUrl}
                  onOpen={() => setModalImageType("mask")}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(160px, 1fr))",
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                <InfoCard label="Vessel" value={selected.vessel_name} />
                <InfoCard label="Area" value={getInspectionAreaLabel(selected.area_type)} />
                <InfoCard label="Location" value={selected.location_tag || "(no tag)"} />
                <InfoCard label="Rust %" value={pct(selected.rust_pct_total || selected.rust_pct)} />

                <InfoCard
                  label="Severity"
                  value={selected.overall_severity || "-"}
                  valueColor={severityColor(selected.overall_severity)}
                />
                <InfoCard
                  label="Review"
                  value={normalizeReviewStatus(selected.review_status)}
                  valueColor={reviewColor(selected.review_status)}
                />
                <InfoCard
                  label="Analysis"
                  value={selected.analysis_status || "PENDING"}
                  valueColor={analysisColor(selected.analysis_status)}
                />
                <InfoCard
                  label="Confidence"
                  value={selected.confidence_score === null ? "-" : pct(selected.confidence_score)}
                />

                <InfoCard
                  label="Image Quality"
                  value={selected.image_quality_score === null ? "-" : pct(selected.image_quality_score)}
                />
                <InfoCard
                  label="False Positive Risk"
                  value={selected.false_positive_risk === null ? "-" : pct(selected.false_positive_risk)}
                />
                <InfoCard
                  label="Largest Patch"
                  value={selected.largest_patch === null ? "-" : pct(selected.largest_patch)}
                />
                <InfoCard
                  label="Cluster Count"
                  value={selected.cluster_count === null ? "-" : String(selected.cluster_count)}
                />
              </div>

              <div
                style={{
                  marginBottom: 18,
                  padding: 14,
                  border: "1px solid #eee",
                  borderRadius: 14,
                  background: "#fafafa",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Warnings</div>
                {selected.raw_warnings && selected.raw_warnings.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {selected.raw_warnings.map((w, idx) => (
                      <li key={`${w}-${idx}`} style={{ marginBottom: 4 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ opacity: 0.7 }}>No warnings</div>
                )}
              </div>

              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 14,
                  padding: 16,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
                    gap: 16,
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <label style={labelStyle}>Decision</label>
                    <select
                      value={decision}
                      onChange={(e) => setDecision(normalizeReviewStatus(e.target.value))}
                      style={inputStyle}
                    >
                      {DECISION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Reviewer Name</label>
                    <input
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="Enter reviewer name"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Reject Reason</label>
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="False positive / poor image / wrong area / other"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Review Notes</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add reviewer remarks"
                    style={{
                      ...inputStyle,
                      minHeight: 150,
                      resize: "vertical",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => saveReview()}
                    disabled={busy}
                    style={{
                      padding: "11px 16px",
                      borderRadius: 12,
                      border: "1px solid #111",
                      background: busy ? "#ddd" : "#111",
                      color: busy ? "#333" : "#fff",
                      fontWeight: 700,
                    }}
                  >
                    {busy ? "Saving..." : "Save Review"}
                  </button>

                  <button
                    onClick={() => {
                      setDecision("APPROVED");
                      setReviewNotes("");
                      setRejectReason("");
                    }}
                    style={{
                      padding: "11px 16px",
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      background: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          )}
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

      <ImageViewerModal
        open={!!modalImageType}
        title={modalTitle}
        src={modalSrc}
        onClose={() => setModalImageType(null)}
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 15,
  boxSizing: "border-box",
};

const panelStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 16,
  overflow: "hidden",
  background: "#fff",
};

const panelHeaderStyle: React.CSSProperties = {
  padding: 14,
  fontWeight: 800,
  borderBottom: "1px solid #eee",
  fontSize: 18,
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

const hintBox: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  fontSize: 13,
};

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid #ddd",
        borderRadius: 16,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.75 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function InfoCard({
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
        padding: 14,
        border: "1px solid #eee",
        borderRadius: 14,
        background: "#fff",
        minHeight: 84,
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.7 }}>{label}</div>
      <div
        style={{
          fontWeight: 800,
          color: valueColor || "#111827",
          marginTop: 6,
          fontSize: 17,
          lineHeight: 1.3,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ImagePanel({
  title,
  src,
  onOpen,
}: {
  title: string;
  src: string | null;
  onOpen: () => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>{title}</div>
      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 14,
          overflow: "hidden",
          height: 240,
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: src ? "zoom-in" : "default",
        }}
        onClick={() => src && onOpen()}
        title={src ? "Click to zoom" : ""}
      >
        {src ? (
          <img
            src={src}
            alt={title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              background: "#fff",
            }}
          />
        ) : (
          <div style={{ opacity: 0.6 }}>No {title.toLowerCase()} preview</div>
        )}
      </div>
    </div>
  );
}

function ImageViewerModal({
  open,
  title,
  src,
  onClose,
}: {
  open: boolean;
  title: string;
  src: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.82)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          color: "#fff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 800,
          fontSize: 18,
        }}
      >
        <span>{title}</span>
        <button
          onClick={onClose}
          style={{
            border: "1px solid rgba(255,255,255,0.35)",
            background: "transparent",
            color: "#fff",
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Close
        </button>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        {src ? (
          <img
            src={src}
            alt={title}
            style={{
              maxWidth: "95vw",
              maxHeight: "85vh",
              objectFit: "contain",
              background: "#fff",
              borderRadius: 12,
            }}
          />
        ) : (
          <div style={{ color: "#fff" }}>No preview available</div>
        )}
      </div>
    </div>
  );
}