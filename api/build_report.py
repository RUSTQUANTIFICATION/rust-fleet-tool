from __future__ import annotations

import os
import tempfile
import urllib.request
from pathlib import Path
from typing import List, Dict, Any

from PIL import Image  # ✅ NEW

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
    PageBreak,
)

from build_main_deck_sheet import build_main_deck_sheet
from build_cargo_hold_sheet import build_cargo_hold_sheet
from cargo_hold_mapping import map_cargo_hold_tag

BASE_DIR = Path(__file__).resolve().parent
REPORT_DIR = BASE_DIR / "generated_reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

# ==========================================================
# ✅ IMAGE OPTIMIZER (MAIN FIX)
# ==========================================================
def optimize_image(image_path: str, max_side: int = 1600, quality: int = 68) -> str:
    try:
        img = Image.open(image_path).convert("RGB")

        w, h = img.size
        scale = min(max_side / max(w, h), 1.0)
        new_size = (int(w * scale), int(h * scale))

        if scale < 1.0:
            img = img.resize(new_size, Image.LANCZOS)

        fd, out_path = tempfile.mkstemp(suffix=".jpg", prefix="opt_")
        os.close(fd)

        img.save(out_path, format="JPEG", quality=quality, optimize=True)
        return out_path

    except Exception:
        return image_path


# ==========================================================
# HELPERS
# ==========================================================
def safe_text(v: Any) -> str:
    return "-" if v is None else str(v)


def safe_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


# ==========================================================
# SUMMARY TABLE
# ==========================================================
def _build_summary_table(approved_rows: List[Dict[str, Any]]):
    rust_vals = [safe_float(r.get("rust_pct")) for r in approved_rows]
    avg_rust = round(sum(rust_vals) / len(rust_vals), 2) if rust_vals else 0.0
    max_rust = round(max(rust_vals), 2) if rust_vals else 0.0

    table = Table(
        [
            ["Metric", "Value"],
            ["Inspection Photos", str(len(approved_rows))],
            ["Average Rust %", str(avg_rust)],
            ["Maximum Rust %", str(max_rust)],
        ],
        colWidths=[80 * mm, 80 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


# ==========================================================
# CARGO HOLD GROUPING
# ==========================================================
def _group_cargo_hold_rows(approved_rows):
    grouped = {}

    for r in approved_rows:
        loc = str(r.get("location_tag") or "").strip()
        mapped = map_cargo_hold_tag(loc, default_hold_no=1)

        if not mapped:
            continue

        hold_no = int(mapped["hold_no"])

        item = {
            **r,
            "hold_no": hold_no,
            "point_no": int(mapped["point_no"]),
            "zone_name": mapped["zone_name"],
            "location_tag": mapped["normalized_tag"],
            "photo_no": int(mapped["point_no"]),
            "has_photo": True,
        }

        grouped.setdefault(hold_no, []).append(item)

    for hold_no in grouped:
        grouped[hold_no] = sorted(grouped[hold_no], key=lambda x: int(x["point_no"]))

    return grouped


# ==========================================================
# IMAGE DOWNLOAD + OPTIMIZATION
# ==========================================================
def _download_image_to_temp(url: str) -> str | None:
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        urllib.request.urlretrieve(url, tmp_path)
        return tmp_path
    except Exception:
        return None


def _resolve_best_image_for_pdf(row: Dict[str, Any]) -> str | None:
    candidates = [
        row.get("marked_image_signed_url"),
        row.get("original_image_signed_url"),
        row.get("image_signed_url"),
    ]

    for url in candidates:
        if not url:
            continue

        tmp = _download_image_to_temp(url)
        if tmp and os.path.exists(tmp):
            return tmp

    local_path = row.get("local_image_path")
    if local_path and os.path.exists(local_path):
        return local_path

    return None


# ==========================================================
# MAIN REPORT BUILDER
# ==========================================================
def build_inspection_report_pdf(
    vessel_name: str,
    area_type: str,
    approved_rows: List[Dict[str, Any]],
    output_filename: str,
):
    styles = getSampleStyleSheet()
    output_path = REPORT_DIR / output_filename
    story = []
    temp_files: List[str] = []

    try:
        # ---------- Title ----------
        story.append(Paragraph("<b>VESSEL CORROSION INSPECTION REPORT</b>", styles["Title"]))
        story.append(Spacer(1, 10))
        story.append(Paragraph(f"Vessel: <b>{safe_text(vessel_name)}</b>", styles["Normal"]))
        story.append(Paragraph(f"Area: <b>{safe_text(area_type)}</b>", styles["Normal"]))
        story.append(Paragraph(f"Inspection Photos: <b>{len(approved_rows)}</b>", styles["Normal"]))
        story.append(Spacer(1, 20))

        # ---------- Summary ----------
        if approved_rows:
            story.append(_build_summary_table(approved_rows))
            story.append(Spacer(1, 20))

        # ---------- Main Deck Map ----------
        if area_type == "MAIN_DECK":
            sheet_path = REPORT_DIR / f"{vessel_name}_main_map.png"

            build_main_deck_sheet(
                inspection_results=[
                    {
                        "point_no": i + 1,
                        "rust_pct": safe_float(r.get("rust_pct")),
                        "has_photo": True,
                    }
                    for i, r in enumerate(approved_rows[:20])
                ],
                output_path=str(sheet_path),
                vessel_name=vessel_name,
            )

            optimized_map = optimize_image(str(sheet_path), 1400, 65)
            temp_files.append(optimized_map)

            story.append(Paragraph("<b>Main Deck Corrosion Map</b>", styles["Heading2"]))
            story.append(Spacer(1, 10))
            story.append(RLImage(optimized_map, width=180 * mm, height=120 * mm))
            story.append(PageBreak())

        # ---------- Cargo Hold Maps ----------
        if area_type == "CARGO_HOLD":
            grouped = _group_cargo_hold_rows(approved_rows)

            for hold_no, hold_rows in grouped.items():
                zone_results = {
                    int(r["point_no"]): {
                        "rust_pct": safe_float(r.get("rust_pct")),
                        "has_photo": True,
                    }
                    for r in hold_rows
                }

                sheet_path = REPORT_DIR / f"{vessel_name}_hold_{hold_no}.png"

                build_cargo_hold_sheet(
                    output_path=str(sheet_path),
                    vessel_name=vessel_name,
                    hold_no=hold_no,
                    zone_results=zone_results,
                )

                optimized_map = optimize_image(str(sheet_path), 1400, 65)
                temp_files.append(optimized_map)

                story.append(Paragraph(f"<b>Hold {hold_no} Map</b>", styles["Heading2"]))
                story.append(Spacer(1, 10))
                story.append(RLImage(optimized_map, width=180 * mm, height=120 * mm))
                story.append(PageBreak())

        # ---------- Photo Pages ----------
        for idx, row in enumerate(approved_rows, start=1):
            story.append(Paragraph(f"<b>Inspection Photo {idx}</b>", styles["Heading3"]))

            rust_pct = safe_float(row.get("rust_pct"))

            table = Table(
                [
                    ["Location", safe_text(row.get("location_tag"))],
                    ["Rust %", f"{rust_pct:.2f}"],
                    ["Severity", safe_text(row.get("overall_severity"))],
                ],
                colWidths=[45 * mm, 135 * mm],
            )

            table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                        ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
                    ]
                )
            )

            story.append(table)
            story.append(Spacer(1, 10))

            img_path = _resolve_best_image_for_pdf(row)

            if img_path:
                optimized = optimize_image(img_path, 1600, 68)
                temp_files.append(optimized)
                story.append(RLImage(optimized, width=150 * mm, height=100 * mm))
            else:
                story.append(Paragraph("Image unavailable", styles["Italic"]))

            story.append(PageBreak())

        # ---------- Build ----------
        doc = SimpleDocTemplate(str(output_path), pagesize=A4)
        doc.build(story)

        return str(output_path)

    finally:
        for f in temp_files:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except Exception:
                pass