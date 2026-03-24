"use client";

import React, { useMemo, useState } from "react";
import type { ReviewPhotoRow, ReviewStatus } from "@/lib/reviewDb";
import { upsertInspectionReview } from "@/lib/reviewDb";
import ImagePreviewModal from "@/components/rust/ImagePreviewModal";

type Props = {
  item: ReviewPhotoRow;
  reviewerName: string;
  originalUrl?: string | null;
  markedUrl?: string | null;
  maskUrl?: string | null;
  onUpdated?: () => void;
};

const REJECT_REASONS = [
  "False positive suspected",
  "Poor image quality",
  "Wrong inspection area",
  "Mask does not match corrosion",
  "Duplicate image",
  "Other",
];

function severityColor(severity: string | null) {
  switch ((severity || "").toUpperCase()) {
    case "LOW":
      return "#15803d";
    case "WATCH":
      return "#ca8a04";
    case "MODERATE":
      return "#ea580c";
    case "HIGH":
    case "SEVERE":
      return "#dc2626";
    default:
      return "#6b7280";
  }
}

function statusColor(status: string | null) {
  switch ((status || "").toUpperCase()) {
    case "APPROVED":
      return "#15803d";
    case "REJECTED":
      return "#dc2626";
    case "PENDING":
      return "#2563eb";
    default:
      return "#6b7280";
  }
}

function analysisColor(status: string | null) {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
      return "#15803d";
    case "PROCESSING":
      return "#2563eb";
    case "FAILED":
      return "#dc2626";
    case "PENDING":
      return "#d97706";
    default:
      return "#6b7280";
  }
}

function num(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(digits);
}

function normalizeReviewStatus(value: string | null | undefined): ReviewStatus {
  const v = String(value || "").trim().toUpperCase();
  if (v === "APPROVED") return "APPROVED";
  if (v === "REJECTED") return "REJECTED";
  return "PENDING";
}

function Thumb({
  title,
  src,
  onClick,
}: {
  title: string;
  src: string | null | undefined;
  onClick: () => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div
        onClick={onClick}
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 10,
          background: "#f8fafc",
          height: 180,
          cursor: src ? "pointer" : "default",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {src ? (
          <img
            src={src}
            alt={title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ color: "#6b7280", fontSize: 13 }}>Not available</span>
        )}
      </div>
    </div>
  );
}

export default function RustReviewCard({
  item,
  reviewerName,
  originalUrl,
  markedUrl,
  maskUrl,
  onUpdated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState(item.review_notes ?? "");
  const [rejectReason, setRejectReason] = useState(item.reject_reason ?? "");
  const [decision, setDecision] = useState<ReviewStatus>(
    normalizeReviewStatus(item.review_status)
  );

  const [modal, setModal] = useState<{
    open: boolean;
    title: string;
    src: string | null;
  }>({
    open: false,
    title: "",
    src: null,
  });

  const warnings = useMemo(() => item.raw_warnings ?? [], [item.raw_warnings]);

  async function saveStatus(status: ReviewStatus) {
    try {
      if (status === "REJECTED" && !rejectReason) {
        alert("Please select a reject reason before rejecting.");
        return;
      }

      setLoading(true);

      await upsertInspectionReview({
        photoId: item.photo_id,
        reviewStatus: status,
        reviewerName: reviewerName || null,
        reviewNotes: reviewNotes || null,
        rejectReason: status === "REJECTED" ? rejectReason || null : null,
      });

      setDecision(status);
      onUpdated?.();
    } catch (err: any) {
      alert(err?.message ?? "Failed to update review");
    } finally {
      setLoading(false);
    }
  }

  const currentStatus = normalizeReviewStatus(item.review_status ?? decision);

  return (
    <>
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 16,
          background: "#fff",
          boxShadow: "0 4px 18px rgba(0,0,0,0.05)",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {item.vessel_name ?? "Unknown Vessel"}
            </div>
            <div style={{ color: "#475569", fontSize: 14 }}>
              Session: {item.session_id ?? "-"} | Area: {item.area_type ?? "-"} | Location:{" "}
              {item.location_tag ?? "-"}
            </div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              Uploaded: {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span
              style={{
                background: severityColor(item.overall_severity),
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Severity: {item.overall_severity ?? "-"}
            </span>

            <span
              style={{
                background: statusColor(currentStatus),
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {currentStatus}
            </span>

            <span
              style={{
                background: analysisColor(item.analysis_status),
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Analysis: {item.analysis_status ?? "PENDING"}
            </span>

            {item.reupload_required ? (
              <span
                style={{
                  background: "#7c3aed",
                  color: "#fff",
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                RE-UPLOAD REQUIRED
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Thumb
            title="Original"
            src={originalUrl}
            onClick={() =>
              originalUrl && setModal({ open: true, title: "Original", src: originalUrl })
            }
          />
          <Thumb
            title="Marked"
            src={markedUrl}
            onClick={() =>
              markedUrl && setModal({ open: true, title: "Marked", src: markedUrl })
            }
          />
          <Thumb
            title="Masked"
            src={maskUrl}
            onClick={() =>
              maskUrl && setModal({ open: true, title: "Masked", src: maskUrl })
            }
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <Info label="Rust %" value={num(item.rust_pct_total ?? item.rust_pct)} />
          <Info label="Confidence" value={num(item.confidence_score)} />
          <Info label="Image Quality" value={num(item.image_quality_score)} />
          <Info label="False Positive Risk" value={num(item.false_positive_risk)} />
          <Info label="Largest Patch" value={num(item.largest_patch)} />
          <Info
            label="Cluster Count"
            value={item.cluster_count === null || item.cluster_count === undefined ? "-" : String(item.cluster_count)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Warnings</div>
          <div style={{ color: "#475569", fontSize: 14 }}>
            {warnings.length > 0 ? warnings.join(", ") : "None"}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Decision</div>
          <select
            value={decision}
            onChange={(e) => setDecision(normalizeReviewStatus(e.target.value))}
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 10,
              background: "#fff",
            }}
          >
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Review Notes</div>
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 10,
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Reject Reason</div>
          <select
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 10,
              background: "#fff",
            }}
          >
            <option value="">Select reason</option>
            {REJECT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <ActionButton
            loading={loading}
            label="Save Decision"
            onClick={() => saveStatus(decision)}
          />
          <ActionButton
            loading={loading}
            label="Approve"
            onClick={() => saveStatus("APPROVED")}
          />
          <ActionButton
            loading={loading}
            label="Reject"
            onClick={() => saveStatus("REJECTED")}
          />
        </div>
      </div>

      <ImagePreviewModal
        open={modal.open}
        onClose={() => setModal({ open: false, title: "", src: null })}
        title={modal.title}
        src={modal.src}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 10,
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid #cbd5e1",
        background: "#fff",
        cursor: loading ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
    >
      {loading ? "Saving..." : label}
    </button>
  );
}