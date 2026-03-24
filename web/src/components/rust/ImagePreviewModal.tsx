"use client";

import React from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  src: string | null;
};

export default function ImagePreviewModal({ open, onClose, title, src }: Props) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <strong>{title}</strong>
          <button onClick={onClose} style={{ cursor: "pointer" }}>
            Close
          </button>
        </div>

        <div
          style={{
            padding: 16,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          {src ? (
            <img
              src={src}
              alt={title}
              style={{
                maxWidth: "100%",
                maxHeight: "80vh",
                objectFit: "contain",
                borderRadius: 8,
                border: "1px solid #d1d5db",
              }}
            />
          ) : (
            <div style={{ color: "#6b7280" }}>Image not available</div>
          )}
        </div>
      </div>
    </div>
  );
}