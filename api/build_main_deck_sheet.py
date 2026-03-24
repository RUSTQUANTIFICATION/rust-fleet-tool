from __future__ import annotations

import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Any

BASE_DIR = Path(__file__).resolve().parent
REPORT_DIR = BASE_DIR / "generated_reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

CANVAS_W = 1500
CANVAS_H = 1000

ZONE_NAMES = {
    1: "POINT 1",
    2: "POINT 2",
    3: "POINT 3",
    4: "POINT 4",
    5: "POINT 5",
    6: "POINT 6",
    7: "POINT 7",
    8: "POINT 8",
    9: "POINT 9",
    10: "POINT 10",
    11: "POINT 11",
    12: "POINT 12",
    13: "POINT 13",
    14: "POINT 14",
    15: "POINT 15",
    16: "POINT 16",
    17: "POINT 17",
    18: "POINT 18",
    19: "POINT 19",
    20: "POINT 20",
}


def rust_color(rust_pct: float):
    # OpenCV BGR
    if rust_pct < 2:
        return (0, 180, 0)      # green
    if rust_pct < 5:
        return (0, 220, 220)    # yellow
    if rust_pct < 12:
        return (0, 140, 255)    # orange
    if rust_pct < 20:
        return (0, 0, 255)      # red
    return (0, 0, 120)          # dark red


def rust_band_label(rust_pct: float) -> str:
    if rust_pct < 2:
        return "LOW"
    if rust_pct < 5:
        return "WATCH"
    if rust_pct < 12:
        return "MOD"
    if rust_pct < 20:
        return "HIGH"
    return "SEVERE"


def safe_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def safe_int(v: Any, default: int) -> int:
    try:
        return int(v)
    except Exception:
        return default


def _normalize_results(inspection_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Supports either:
    [{"rust_pct": 1.2}, ...]
    or:
    [{"point_no":1,"photo_no":1,"zone_name":"POINT 1","rust_pct":1.2}, ...]
    """
    normalized: List[Dict[str, Any]] = []

    for idx, item in enumerate(inspection_results, start=1):
        point_no = safe_int(item.get("point_no"), idx)
        normalized.append(
            {
                "point_no": point_no,
                "photo_no": safe_int(item.get("photo_no"), point_no),
                "zone_name": str(item.get("zone_name") or ZONE_NAMES.get(point_no, f"POINT {point_no}")),
                "rust_pct": safe_float(item.get("rust_pct")),
                "has_photo": bool(item.get("has_photo", True)),
            }
        )

    return normalized


def _create_canvas():
    return np.full((CANVAS_H, CANVAS_W, 3), 255, dtype=np.uint8)


def _draw_title(img, vessel_name: str | None):
    font = cv2.FONT_HERSHEY_SIMPLEX
    title = "MAIN DECK CORROSION MAP"
    if vessel_name:
        title = f"{vessel_name} - MAIN DECK CORROSION MAP"

    cv2.putText(img, title, (40, 42), font, 1.0, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(
        img,
        "20 fixed inspection points aligned to approved main deck reference map",
        (42, 76),
        font,
        0.58,
        (35, 35, 35),
        2,
        cv2.LINE_AA,
    )


def _draw_ship_schematic(img):
    """
    Draw deck based on the uploaded reference map:
    - long rectangular deck
    - accommodation forward left
    - 5 cargo hold blocks
    - hatch cranes
    - aft machinery / poop zone
    """
    deck_color = (211, 238, 238)  # light cyan feel similar to map
    line_color = (0, 0, 0)
    hold_fill = (215, 245, 245)
    blue_fill = (230, 120, 20)  # BGR-like darkish blue blocks if needed
    crane_fill = (255, 160, 0)

    # Outer deck
    deck = np.array(
        [
            [30, 120],
            [1320, 120],
            [1320, 135],
            [1368, 135],
            [1368, 150],
            [1410, 150],
            [1410, 365],
            [1368, 365],
            [1368, 380],
            [1320, 380],
            [1320, 395],
            [30, 395],
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(img, [deck], deck_color)
    cv2.polylines(img, [deck], True, line_color, 2)

    # Bottom station line strip
    cv2.rectangle(img, (30, 365), (1410, 395), (235, 235, 235), -1)
    cv2.rectangle(img, (30, 365), (1410, 395), line_color, 1)

    # Forward accommodation block
    cv2.rectangle(img, (95, 150), (190, 330), (255, 140, 0), -1)
    cv2.rectangle(img, (95, 150), (190, 330), line_color, 2)
    cv2.putText(img, "ACCOMMODATION", (102, 245), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)

    # Ladder / details on forward left
    for y in [185, 235, 285]:
        cv2.rectangle(img, (52, y), (68, y + 22), (0, 180, 0), -1)
        cv2.rectangle(img, (52, y), (68, y + 22), line_color, 1)
        cv2.line(img, (60, y), (60, y + 22), (255, 255, 255), 1)
        cv2.line(img, (52, y + 6), (68, y + 6), (255, 255, 255), 1)
        cv2.line(img, (52, y + 12), (68, y + 12), (255, 255, 255), 1)
        cv2.line(img, (52, y + 18), (68, y + 18), (255, 255, 255), 1)

    # Cargo holds
    holds = [
        (250, 150, 350, 330, "HC 6"),
        (445, 150, 545, 330, "HC 5"),
        (640, 150, 740, 330, "HC 4"),
        (835, 150, 935, 330, "HC 3"),
        (1030, 150, 1130, 330, "HC 2"),
    ]
    for x1, y1, x2, y2, label in holds:
        cv2.rectangle(img, (x1, y1), (x2, y2), hold_fill, -1)
        cv2.rectangle(img, (x1, y1), (x2, y2), line_color, 2)
        cv2.putText(img, label, (x1 + 6, 322), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1, cv2.LINE_AA)

    # Cranes / booms
    crane_specs = [
        ((365, 205), (560, 245)),
        ((675, 195), (915, 245)),
        ((900, 180), (1095, 205)),
    ]
    for (x1, y1), (x2, y2) in crane_specs:
        cv2.line(img, (x1, y1), (x2, y2), (255, 120, 0), 18, cv2.LINE_AA)
        cv2.circle(img, (x1, y1), 18, (255, 120, 0), -1)
        cv2.circle(img, (x2, y2), 16, (255, 120, 0), -1)
        cv2.circle(img, (x1, y1), 18, line_color, 1)
        cv2.circle(img, (x2, y2), 16, line_color, 1)

    # Aft open area / HC1 block zone
    cv2.rectangle(img, (1220, 170), (1315, 320), hold_fill, -1)
    cv2.rectangle(img, (1220, 170), (1315, 320), line_color, 2)
    cv2.putText(img, "HC 1", (1228, 322), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1, cv2.LINE_AA)

    for y in [190, 255]:
        cv2.rectangle(img, (1266, y), (1282, y + 22), (0, 180, 0), -1)
        cv2.rectangle(img, (1266, y), (1282, y + 22), line_color, 1)
        cv2.line(img, (1274, y), (1274, y + 22), (255, 255, 255), 1)
        cv2.line(img, (1266, y + 6), (1282, y + 6), (255, 255, 255), 1)
        cv2.line(img, (1266, y + 12), (1282, y + 12), (255, 255, 255), 1)
        cv2.line(img, (1266, y + 18), (1282, y + 18), (255, 255, 255), 1)

    # Aft stern details
    cv2.rectangle(img, (1370, 195), (1382, 300), (255, 255, 255), -1)
    cv2.rectangle(img, (1370, 195), (1382, 300), line_color, 1)
    cv2.line(img, (1376, 195), (1376, 300), (0, 180, 220), 1)
    for yy in [212, 235, 258, 281]:
        cv2.line(img, (1370, yy), (1382, yy), (0, 180, 220), 1)

    cv2.arrowedLine(img, (1350, 260), (1310, 260), (0, 0, 0), 1, cv2.LINE_AA, tipLength=0.25)

    # bottom frame/station labels
    station_marks = [
        (60, "Frame"),
        (130, "11"),
        (190, "36"),
        (255, "40"),
        (330, "68"),
        (430, "78"),
        (555, "108"),
        (685, "116"),
        (810, "147"),
        (940, "155"),
        (1070, "186"),
        (1195, "195"),
        (1275, "211"),
        (1345, "216"),
        (1400, "235"),
    ]
    for i in range(len(station_marks) - 1):
        x, label = station_marks[i]
        next_x, _ = station_marks[i + 1]
        cv2.line(img, (next_x, 365), (next_x, 395), line_color, 1)
        cv2.putText(img, label, (x, 388), cv2.FONT_HERSHEY_SIMPLEX, 0.34, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(img, station_marks[-1][1], (station_marks[-1][0], 388), cv2.FONT_HERSHEY_SIMPLEX, 0.34, (0, 0, 0), 1, cv2.LINE_AA)


def _point_layout():
    """
    Point layout aligned with the uploaded map.
    """
    return {
        1: (62, 138),
        2: (62, 232),
        3: (35, 348),
        4: (210, 345),
        5: (206, 230),
        6: (208, 136),
        7: (445, 132),
        8: (470, 336),
        9: (610, 336),
        10: (610, 140),
        11: (815, 140),
        12: (830, 336),
        13: (1060, 132),
        14: (1005, 336),
        15: (1215, 336),
        16: (1215, 135),
        17: (1350, 135),
        18: (1320, 342),
        19: (1400, 290),
        20: (1405, 190),
    }


def _label_anchor_layout():
    """
    Text anchor points for rust % and severity near each numbered point.
    """
    return {
        1: (40, 150, 38, 120),
        2: (38, 244, 30, 214),
        3: (18, 360, 10, 330),
        4: (188, 358, 180, 328),
        5: (184, 244, 176, 214),
        6: (186, 150, 178, 120),
        7: (423, 145, 412, 115),
        8: (448, 349, 438, 319),
        9: (588, 349, 578, 319),
        10: (588, 153, 578, 123),
        11: (793, 153, 783, 123),
        12: (808, 349, 798, 319),
        13: (1038, 145, 1028, 115),
        14: (983, 349, 973, 319),
        15: (1193, 349, 1183, 319),
        16: (1193, 148, 1183, 118),
        17: (1328, 148, 1318, 118),
        18: (1298, 355, 1288, 325),
        19: (1378, 303, 1368, 273),
        20: (1383, 203, 1373, 173),
    }


def _draw_legend(img):
    font = cv2.FONT_HERSHEY_SIMPLEX
    legend_items = [
        ("No photo", (255, 255, 255)),
        ("0-2%  LOW", (0, 180, 0)),
        ("2-5%  WATCH", (0, 220, 220)),
        ("5-12% MOD", (0, 140, 255)),
        ("12-20% HIGH", (0, 0, 255)),
        (">20%  SEVERE", (0, 0, 120)),
    ]

    x = 1195
    y = 470

    cv2.putText(img, "Legend", (x, y - 18), font, 0.78, (0, 0, 0), 2, cv2.LINE_AA)

    for label, color in legend_items:
        cv2.rectangle(img, (x, y), (x + 42, y + 28), color, -1)
        cv2.rectangle(img, (x, y), (x + 42, y + 28), (0, 0, 0), 1)
        cv2.putText(img, label, (x + 54, y + 21), font, 0.50, (0, 0, 0), 1, cv2.LINE_AA)
        y += 38


def _draw_coverage_box(img, inspection_results: List[Dict[str, Any]]):
    font = cv2.FONT_HERSHEY_SIMPLEX

    provided = sum(1 for x in inspection_results[:20] if x.get("has_photo", True))
    rust_vals = [safe_float(x.get("rust_pct")) for x in inspection_results[:20] if x.get("has_photo", True)]

    avg_rust = round(sum(rust_vals) / len(rust_vals), 2) if rust_vals else 0.0
    max_rust = round(max(rust_vals), 2) if rust_vals else 0.0

    x1, y1, x2, y2 = 1190, 720, 1455, 835
    cv2.rectangle(img, (x1, y1), (x2, y2), (245, 245, 245), -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 0), 1)

    cv2.putText(img, "Coverage Summary", (x1 + 12, y1 + 24), font, 0.62, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, f"Photos: {provided}/20", (x1 + 12, y1 + 52), font, 0.50, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(img, f"Avg rust: {avg_rust:.2f}%", (x1 + 12, y1 + 78), font, 0.50, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.putText(img, f"Max rust: {max_rust:.2f}%", (x1 + 12, y1 + 104), font, 0.50, (0, 0, 0), 1, cv2.LINE_AA)


def _draw_reference_table(img, inspection_results: List[Dict[str, Any]]):
    font = cv2.FONT_HERSHEY_SIMPLEX

    x1, y1, x2, y2 = 40, 455, 1120, 945
    cv2.rectangle(img, (x1, y1), (x2, y2), (248, 248, 248), -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 0), 1)

    cv2.putText(img, "Photo / Point Reference", (x1 + 12, y1 + 28), font, 0.66, (0, 0, 0), 2, cv2.LINE_AA)

    # table headers
    headers = [("Point", 60), ("Photo", 145), ("Zone", 245), ("Rust %", 640), ("Band", 770), ("Photo?", 910)]
    for text, x in headers:
        cv2.putText(img, text, (x, y1 + 58), font, 0.48, (0, 0, 0), 1, cv2.LINE_AA)

    cv2.line(img, (x1 + 10, y1 + 68), (x2 - 10, y1 + 68), (160, 160, 160), 1)

    row_y = y1 + 95
    for idx, item in enumerate(inspection_results[:20], start=1):
        rust = safe_float(item.get("rust_pct"))
        has_photo = bool(item.get("has_photo", True))
        rust_text = f"{rust:.1f}%" if has_photo else "-"
        band = rust_band_label(rust) if has_photo else "NO PHOTO"
        photo_text = "YES" if has_photo else "NO"

        cv2.putText(img, str(idx), (60, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(img, str(item.get("photo_no", idx)), (145, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(img, str(item["zone_name"]), (245, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(img, rust_text, (640, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(img, band, (770, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(img, photo_text, (910, row_y), font, 0.46, (0, 0, 0), 1, cv2.LINE_AA)

        row_y += 20


def _draw_points(img, inspection_results: List[Dict[str, Any]]):
    font = cv2.FONT_HERSHEY_SIMPLEX
    points = _point_layout()
    anchors = _label_anchor_layout()
    result_map = {int(x["point_no"]): x for x in inspection_results[:20]}

    for point_no in range(1, 21):
        x, y = points[point_no]
        pct_x, pct_y, sev_x, sev_y = anchors[point_no]

        item = result_map.get(point_no)
        rust = safe_float(item["rust_pct"]) if item else 0.0
        has_photo = bool(item["has_photo"]) if item else False
        photo_no = safe_int(item["photo_no"], point_no) if item else point_no

        color = rust_color(rust) if has_photo else (255, 255, 255)

        # red outer ring similar to map
        cv2.circle(img, (x, y), 10, (0, 0, 255), 3)
        cv2.circle(img, (x, y), 10, (255, 255, 255), -1)
        cv2.circle(img, (x, y), 10, (0, 0, 255), 2)

        label = str(photo_no)
        if len(label) == 1:
            tx = x - 4
        else:
            tx = x - 8

        cv2.putText(img, label, (tx, y + 4), font, 0.42, (255, 140, 0), 2, cv2.LINE_AA)

        # arrow from label vicinity toward point
        arrow_from = (max(8, x - 45), max(8, y + 8))
        cv2.arrowedLine(img, arrow_from, (x - 10, y + 2), (0, 165, 255), 1, cv2.LINE_AA, tipLength=0.35)

        # rust percentage below / beside point
        pct_text = f"{rust:.1f}%" if has_photo else "-"
        cv2.putText(img, pct_text, (pct_x, pct_y), font, 0.34, (0, 0, 0), 1, cv2.LINE_AA)

        # severity above / near point
        sev = rust_band_label(rust) if has_photo else "NO PHOTO"
        cv2.putText(img, sev, (sev_x, sev_y), font, 0.30, (30, 30, 30), 1, cv2.LINE_AA)

                # small colored status dot beside main point
        dot_color = color if has_photo else (255, 255, 255)
        cv2.circle(img, (x + 16, y - 14), 4, dot_color, -1)
        cv2.circle(img, (x + 16, y - 14), 4, (0, 0, 0), 1)


def _draw_footer(img):
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(
        img,
        "Numbered markers follow the approved 20-point main deck map. White marker means no photo uploaded.",
        (40, 978),
        font,
        0.46,
        (20, 20, 20),
        1,
        cv2.LINE_AA,
    )


def build_main_deck_sheet(
    inspection_results: List[Dict[str, Any]],
    output_path: str,
    vessel_name: str | None = None,
):
    """
    inspection_results examples:

    Simple:
    [
      {"rust_pct": 1.2},
      {"rust_pct": 0.5},
      ...
    ]

    Rich:
    [
      {"point_no": 1, "photo_no": 1, "zone_name": "POINT 1", "rust_pct": 1.2, "has_photo": True},
      ...
      {"point_no": 20, "photo_no": 20, "zone_name": "POINT 20", "rust_pct": 0.0, "has_photo": False},
    ]
    """
    img = _create_canvas()
    inspection_results = _normalize_results(inspection_results)

    existing = {int(x["point_no"]): x for x in inspection_results}
    final_results: List[Dict[str, Any]] = []

    for i in range(1, 21):
        if i in existing:
            final_results.append(existing[i])
        else:
            final_results.append(
                {
                    "point_no": i,
                    "photo_no": i,
                    "zone_name": ZONE_NAMES[i],
                    "rust_pct": 0.0,
                    "has_photo": False,
                }
            )

    _draw_title(img, vessel_name)
    _draw_ship_schematic(img)
    _draw_legend(img)
    _draw_coverage_box(img, final_results)
    _draw_reference_table(img, final_results)
    _draw_points(img, final_results)
    _draw_footer(img)

    cv2.imwrite(output_path, img)
    return output_path


if __name__ == "__main__":
    demo_results = [
        {"point_no": 1, "photo_no": 1, "zone_name": "POINT 1", "rust_pct": 1.2, "has_photo": True},
        {"point_no": 2, "photo_no": 2, "zone_name": "POINT 2", "rust_pct": 0.7, "has_photo": True},
        {"point_no": 3, "photo_no": 3, "zone_name": "POINT 3", "rust_pct": 3.8, "has_photo": True},
        {"point_no": 4, "photo_no": 4, "zone_name": "POINT 4", "rust_pct": 2.1, "has_photo": True},
        {"point_no": 5, "photo_no": 5, "zone_name": "POINT 5", "rust_pct": 6.4, "has_photo": True},
        {"point_no": 6, "photo_no": 6, "zone_name": "POINT 6", "rust_pct": 1.4, "has_photo": True},
        {"point_no": 7, "photo_no": 7, "zone_name": "POINT 7", "rust_pct": 0.5, "has_photo": True},
        {"point_no": 8, "photo_no": 8, "zone_name": "POINT 8", "rust_pct": 4.9, "has_photo": True},
        {"point_no": 9, "photo_no": 9, "zone_name": "POINT 9", "rust_pct": 13.2, "has_photo": True},
        {"point_no": 10, "photo_no": 10, "zone_name": "POINT 10", "rust_pct": 5.8, "has_photo": True},
        {"point_no": 11, "photo_no": 11, "zone_name": "POINT 11", "rust_pct": 2.0, "has_photo": True},
        {"point_no": 12, "photo_no": 12, "zone_name": "POINT 12", "rust_pct": 1.1, "has_photo": True},
        {"point_no": 13, "photo_no": 13, "zone_name": "POINT 13", "rust_pct": 0.8, "has_photo": True},
        {"point_no": 14, "photo_no": 14, "zone_name": "POINT 14", "rust_pct": 3.6, "has_photo": True},
        {"point_no": 15, "photo_no": 15, "zone_name": "POINT 15", "rust_pct": 8.4, "has_photo": True},
        {"point_no": 16, "photo_no": 16, "zone_name": "POINT 16", "rust_pct": 4.2, "has_photo": True},
        {"point_no": 17, "photo_no": 17, "zone_name": "POINT 17", "rust_pct": 0.9, "has_photo": True},
        {"point_no": 18, "photo_no": 18, "zone_name": "POINT 18", "rust_pct": 0.4, "has_photo": True},
        {"point_no": 19, "photo_no": 19, "zone_name": "POINT 19", "rust_pct": 3.1, "has_photo": True},
        {"point_no": 20, "photo_no": 20, "zone_name": "POINT 20", "rust_pct": 7.2, "has_photo": True},
    ]

    out = REPORT_DIR / "demo_main_deck_sheet.png"
    build_main_deck_sheet(
        inspection_results=demo_results,
        output_path=str(out),
        vessel_name="DEMO VESSEL",
    )
    print(f"Saved: {out}")