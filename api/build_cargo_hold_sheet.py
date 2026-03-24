from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


# ============================================================
# Config
# ============================================================

CANVAS_W = 2200
CANVAS_H = 1450
BG = (245, 247, 250)

LINE = (25, 25, 25)
TEXT = (25, 25, 25)
MUTED = (80, 80, 80)
WHITE = (255, 255, 255)

GREEN = (0, 180, 0)
YELLOW = (220, 220, 0)
ORANGE = (255, 153, 0)
RED = (220, 0, 0)
DARK_RED = (140, 0, 0)

TITLE_SIZE = 42
SUBTITLE_SIZE = 18
ZONE_LABEL_SIZE = 20
SIDE_LABEL_SIZE = 18
MARKER_NUM_SIZE = 26
MARKER_VALUE_SIZE = 36   # doubled
LEGEND_TITLE_SIZE = 28   # increased
LEGEND_TEXT_SIZE = 24    # doubled-ish
REF_TEXT_SIZE = 24       # doubled-ish

MARKER_R = 28
MARKER_OUTLINE = 3


# ============================================================
# Data model
# ============================================================

@dataclass
class ZoneResult:
    zone_no: int
    label: str
    rust_pct: Optional[float] = None


# ============================================================
# Drawing helpers
# ============================================================

def _load_font(size: int, bold: bool = False):
    candidates = []
    if bold:
        candidates = [
            "arialbd.ttf",
            "Arial Bold.ttf",
            "DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ]
    else:
        candidates = [
            "arial.ttf",
            "Arial.ttf",
            "DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/Library/Fonts/Arial.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ]

    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass

    return ImageFont.load_default()


def draw_text_center(draw: ImageDraw.ImageDraw, text: str, center: Tuple[int, int], font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = center[0] - w // 2
    y = center[1] - h // 2
    draw.text((x, y), text, font=font, fill=fill)


def draw_multiline_center(
    draw: ImageDraw.ImageDraw,
    text: str,
    center: Tuple[int, int],
    font,
    fill,
    spacing: int = 4,
):
    lines = text.split("\n")
    boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    heights = [(b[3] - b[1]) for b in boxes]
    widths = [(b[2] - b[0]) for b in boxes]

    total_h = sum(heights) + spacing * (len(lines) - 1)
    top_y = center[1] - total_h // 2

    y = top_y
    for line, w, h in zip(lines, widths, heights):
        x = center[0] - w // 2
        draw.text((x, y), line, font=font, fill=fill)
        y += h + spacing


def draw_rotated_text_center(
    base_img: Image.Image,
    text: str,
    center: Tuple[int, int],
    angle: int,
    font,
    fill=(40, 40, 40),
):
    dummy = Image.new("RGBA", (10, 10), (255, 255, 255, 0))
    d = ImageDraw.Draw(dummy)
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]

    pad = 8
    txt = Image.new("RGBA", (w + pad * 2, h + pad * 2), (255, 255, 255, 0))
    td = ImageDraw.Draw(txt)
    td.text((pad, pad), text, font=font, fill=fill)
    rot = txt.rotate(angle, expand=True)

    x = center[0] - rot.size[0] // 2
    y = center[1] - rot.size[1] // 2
    base_img.alpha_composite(rot, (x, y))


def severity_color(rust_pct: Optional[float]) -> Tuple[int, int, int]:
    if rust_pct is None:
        return WHITE
    if rust_pct < 2:
        return GREEN
    if rust_pct < 5:
        return YELLOW
    if rust_pct < 12:
        return ORANGE
    if rust_pct < 20:
        return RED
    return DARK_RED


def rust_text(rust_pct: Optional[float]) -> str:
    if rust_pct is None:
        return "–"
    return f"{rust_pct:.1f}%"


# ============================================================
# Layout
# ============================================================

ZONE_BOXES = {
    1: {"label": "FWD BULKHEAD", "box": (360, 220, 660, 420)},
    2: {"label": "PORT BULKHEAD", "box": (200, 420, 360, 760)},
    3: {"label": "FLOOR", "box": (360, 420, 660, 760)},
    4: {"label": "STBD BULKHEAD", "box": (660, 420, 820, 760)},
    5: {"label": "AFT BULKHEAD", "box": (360, 760, 660, 980)},
    6: {"label": "UNDERSIDE OF\nHATCH COVER", "box": (360, 980, 660, 1280)},

    7: {"label": "FWD AREA OF HATCH COVER", "box": (1100, 360, 1500, 500)},
    8: {"label": "PORT SIDE OF HATCH COVER", "box": (1020, 500, 1100, 900)},
    9: {"label": "TOP SIDE OF HATCH COVER", "box": (1100, 500, 1500, 900)},
    10: {"label": "STBD SIDE OF HATCH COVER", "box": (1500, 500, 1580, 900)},
    11: {"label": "AFT PART OF HATCH COVER", "box": (1100, 900, 1500, 1040)},
}

SIDE_ZONE_IDS = {8, 10}

LEGEND_X = 1715
LEGEND_Y = 250
REFERENCE_BOX = (1685, 640, 2130, 1290)
COVERAGE_BOX = (1120, 1080, 1500, 1245)   # moved below hatch cover


# ============================================================
# Main builder
# ============================================================

def build_cargo_hold_sheet(
    output_path: str,
    vessel_name: str,
    hold_no: int,
    zone_results: Dict[int, ZoneResult | dict | float | int | None],
) -> str:
    output_path = str(output_path)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG + (255,))
    draw = ImageDraw.Draw(img)

    title_font = _load_font(TITLE_SIZE, bold=True)
    subtitle_font = _load_font(SUBTITLE_SIZE, bold=False)
    zone_font = _load_font(ZONE_LABEL_SIZE, bold=True)
    side_zone_font = _load_font(SIDE_LABEL_SIZE, bold=True)
    marker_num_font = _load_font(MARKER_NUM_SIZE, bold=True)
    marker_value_font = _load_font(MARKER_VALUE_SIZE, bold=True)
    legend_title_font = _load_font(LEGEND_TITLE_SIZE, bold=True)
    legend_text_font = _load_font(LEGEND_TEXT_SIZE, bold=False)
    ref_font = _load_font(REF_TEXT_SIZE, bold=False)

    draw.text(
        (90, 95),
        f"{vessel_name}  —  HOLD {hold_no}  CORROSION MAP",
        font=title_font,
        fill=TEXT,
    )
    draw.text(
        (95, 150),
        "11 fixed cargo hold inspection locations with rust severity color coding",
        font=subtitle_font,
        fill=MUTED,
    )

    for zone_id, zone in ZONE_BOXES.items():
        x1, y1, x2, y2 = zone["box"]
        line_w = 4 if zone_id in {1, 3, 5, 7, 9, 11} else 3
        draw.rectangle((x1, y1, x2, y2), outline=LINE, width=line_w)

    assigned_count = 0
    rust_values = []

    reference_names = {
        1: "FWD BULKHEAD",
        2: "PORT BULKHEAD",
        3: "FLOOR",
        4: "STBD BULKHEAD",
        5: "AFT BULKHEAD",
        6: "UNDERSIDE OF HATCH COVER",
        7: "FWD AREA OF HATCH COVER",
        8: "PORT SIDE OF HATCH COVER",
        9: "TOP SIDE OF HATCH COVER",
        10: "STBD SIDE OF HATCH COVER",
        11: "AFT PART OF HATCH COVER",
    }

    for zone_id in range(1, 12):
        zone = ZONE_BOXES[zone_id]
        x1, y1, x2, y2 = zone["box"]
        label = str(zone["label"])

        raw = zone_results.get(zone_id)
        rust_pct: Optional[float] = None

        if isinstance(raw, ZoneResult):
            rust_pct = raw.rust_pct
        elif isinstance(raw, dict):
            val = raw.get("rust_pct")
            if val is None:
                val = raw.get("rust_pct_total")
            rust_pct = float(val) if val is not None else None
        elif raw is None:
            rust_pct = None
        else:
            rust_pct = float(raw)

        if rust_pct is not None:
            assigned_count += 1
            rust_values.append(rust_pct)

        box_cx = (x1 + x2) // 2
        box_cy = (y1 + y2) // 2

        marker_cx = box_cx
        marker_cy = y1 + 38

        fill = severity_color(rust_pct)

        draw.ellipse(
            (
                marker_cx - MARKER_R,
                marker_cy - MARKER_R,
                marker_cx + MARKER_R,
                marker_cy + MARKER_R,
            ),
            fill=fill,
            outline=LINE,
            width=MARKER_OUTLINE,
        )

        draw_text_center(
            draw,
            str(zone_id),
            (marker_cx, marker_cy),
            marker_num_font,
            TEXT if rust_pct is None or rust_pct < 5 else WHITE,
        )

        if zone_id in SIDE_ZONE_IDS:
            draw_rotated_text_center(
                img,
                label,
                center=(box_cx, box_cy),
                angle=270 if zone_id == 8 else 90,
                font=side_zone_font,
                fill=TEXT,
            )
        else:
            draw_multiline_center(
                draw,
                label,
                center=(box_cx, box_cy - 4),
                font=zone_font,
                fill=TEXT,
                spacing=4,
            )

        draw_text_center(
            draw,
            rust_text(rust_pct),
            (box_cx, y2 - 28),
            marker_value_font,
            (0, 102, 204),   # always blue
        )

    avg_rust = sum(rust_values) / len(rust_values) if rust_values else 0.0
    max_rust = max(rust_values) if rust_values else 0.0

    draw.text((LEGEND_X, LEGEND_Y - 42), "Legend", font=legend_title_font, fill=TEXT)

    legend_rows = [
        ("No photo", WHITE),
        ("0–2%   LOW", GREEN),
        ("2–5%   WATCH", YELLOW),
        ("5–12%  MOD", ORANGE),
        ("12–20% HIGH", RED),
        (">20%   SEVERE", DARK_RED),
    ]

    ly = LEGEND_Y
    for label, color in legend_rows:
        draw.rectangle((LEGEND_X, ly, LEGEND_X + 52, ly + 30), fill=color, outline=LINE, width=1)
        draw.text((LEGEND_X + 68, ly), label, font=legend_text_font, fill=TEXT)
        ly += 48

    draw.rectangle(COVERAGE_BOX, outline=(120, 120, 120), width=2)
    draw.text((COVERAGE_BOX[0] + 14, COVERAGE_BOX[1] + 12), "Inspection Coverage", font=legend_title_font, fill=TEXT)
    draw.text(
        (COVERAGE_BOX[0] + 14, COVERAGE_BOX[1] + 55),
        f"Photos assigned : {assigned_count}/11",
        font=legend_text_font,
        fill=TEXT,
    )
    draw.text(
        (COVERAGE_BOX[0] + 14, COVERAGE_BOX[1] + 93),
        f"Average rust % : {avg_rust:.2f}",
        font=legend_text_font,
        fill=TEXT,
    )
    draw.text(
        (COVERAGE_BOX[0] + 14, COVERAGE_BOX[1] + 131),
        f"Maximum rust % : {max_rust:.2f}",
        font=legend_text_font,
        fill=TEXT,
    )

    draw.rectangle(REFERENCE_BOX, outline=(120, 120, 120), width=2)
    draw.text(
        (REFERENCE_BOX[0] + 14, REFERENCE_BOX[1] + 12),
        "Photo / Zone Reference",
        font=legend_title_font,
        fill=TEXT,
    )

    ref_y = REFERENCE_BOX[1] + 58
    for zone_id in range(1, 12):
        raw = zone_results.get(zone_id)
        rust_pct: Optional[float] = None

        if isinstance(raw, ZoneResult):
            rust_pct = raw.rust_pct
        elif isinstance(raw, dict):
            val = raw.get("rust_pct")
            if val is None:
                val = raw.get("rust_pct_total")
            rust_pct = float(val) if val is not None else None
        elif raw is None:
            rust_pct = None
        else:
            rust_pct = float(raw)

        text_line = f"{zone_id}. {reference_names[zone_id]} | {rust_text(rust_pct)}"
        draw.text((REFERENCE_BOX[0] + 14, ref_y), text_line, font=ref_font, fill=TEXT)
        ref_y += 44

    rgb = Image.new("RGB", img.size, BG)
    rgb.paste(img, mask=img.split()[3])
    rgb.save(output_path)
    return output_path


if __name__ == "__main__":
    demo = {
        1: 20.6,
        2: 2.8,
        3: 1.3,
        4: 1.0,
        5: 1.7,
        6: 1.8,
        7: 17.9,
        8: 6.7,
        9: 1.5,
        10: 2.5,
        11: 3.5,
    }

    out = Path("generated_reports/demo_cargo_hold_sheet.png")
    build_cargo_hold_sheet(
        output_path=str(out),
        vessel_name="Xinhui Express",
        hold_no=1,
        zone_results=demo,
    )
    print(f"Saved: {out.resolve()}")