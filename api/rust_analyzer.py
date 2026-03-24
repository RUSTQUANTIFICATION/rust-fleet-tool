# api/rust_analyzer.py
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Any, Tuple, Optional, List

import cv2
import numpy as np

try:
    from ultralytics import YOLO  # optional
except Exception:
    YOLO = None


AREA_TYPES = {
    "CARGO_HOLD",
    "MAIN_DECK",
    "VOID_SPACE",
    "CARGO_TANK",
    "BALLAST_TANK",
}

CLASS_ID_TO_NAME = {
    0: "light_rust",
    1: "moderate_rust",
    2: "heavy_rust",
    3: "coating_breakdown",
    4: "pitting",
    5: "stain_or_false_positive",
}


@dataclass
class RustConfig:
    area_type: str = "MAIN_DECK"

    # analyzer mode
    analyzer_mode: str = "auto"  # heuristic | model | auto

    # optional model mode
    model_path: Optional[str] = None
    model_conf: float = 0.25
    model_imgsz: int = 1024

    # resize
    max_side: int = 1600

    # base HSV windows
    hsv_low: Tuple[int, int, int] = (6, 65, 35)
    hsv_high: Tuple[int, int, int] = (26, 255, 255)

    hsv_low_2: Tuple[int, int, int] = (0, 55, 18)
    hsv_high_2: Tuple[int, int, int] = (14, 255, 145)

    # morphology
    open_ksize: int = 3
    close_ksize: int = 7
    min_component_area_px: int = 500

    # severity split by V channel
    heavy_v_max: int = 85
    moderate_v_max: int = 150

    # glare suppression
    glare_v_min: int = 230
    glare_s_max: int = 35

    # rejectors
    low_sat_reject: int = 45
    smooth_std_reject: float = 12.0
    min_fill_ratio: float = 0.08
    max_aspect_ratio: float = 12.0

    # large smooth region rejection
    max_fill_ratio_for_large_area: float = 0.45
    large_area_px: int = 25000
    edge_density_reject: float = 0.015

    # cargo hold coating suppression
    cargo_hold_use_coating_reject: bool = True
    coating_lab_dist_reject: float = 18.0
    coating_hue_dist_reject: int = 8
    coating_sat_diff_reject: int = 35
    edge_keep_override: float = 0.035

    # tank/space lighting normalization
    apply_clahe: bool = True
    clahe_clip_limit: float = 2.0
    clahe_tile_grid: Tuple[int, int] = (8, 8)

    # area calibration
    class_weights: Dict[str, float] = field(default_factory=dict)
    severity_thresholds: Dict[str, float] = field(default_factory=dict)


@dataclass
class RustResult:
    rust_pct_total: float
    rust_pct_light: float
    rust_pct_moderate: float
    rust_pct_heavy: float
    severity: str
    confidence: float
    debug: Dict[str, Any]


def get_area_calibration(area_type: str) -> Dict[str, Any]:
    area_type = (area_type or "").strip().upper()

    defaults = {
        "class_weights": {
            "light_rust": 1.00,
            "moderate_rust": 1.00,
            "heavy_rust": 1.00,
            "coating_breakdown": 1.10,
            "pitting": 1.15,
            "stain_or_false_positive": 0.00,
        },
        "severity_thresholds": {
            "LOW": 3.0,
            "MODERATE": 8.0,
            "HIGH": 15.0,
        },
    }

    table = {
        "MAIN_DECK": {
            "class_weights": {
                "light_rust": 1.00,
                "moderate_rust": 1.00,
                "heavy_rust": 1.00,
                "coating_breakdown": 1.12,
                "pitting": 1.18,
                "stain_or_false_positive": 0.00,
            },
            "severity_thresholds": {
                "LOW": 3.0,
                "MODERATE": 8.0,
                "HIGH": 15.0,
            },
        },
        "CARGO_HOLD": {
            "class_weights": {
                "light_rust": 0.95,
                "moderate_rust": 1.00,
                "heavy_rust": 1.06,
                "coating_breakdown": 1.10,
                "pitting": 1.12,
                "stain_or_false_positive": 0.00,
            },
            "severity_thresholds": {
                "LOW": 4.0,
                "MODERATE": 10.0,
                "HIGH": 18.0,
            },
        },
        "VOID_SPACE": {
            "class_weights": {
                "light_rust": 1.08,
                "moderate_rust": 1.14,
                "heavy_rust": 1.20,
                "coating_breakdown": 1.22,
                "pitting": 1.28,
                "stain_or_false_positive": 0.00,
            },
            "severity_thresholds": {
                "LOW": 2.5,
                "MODERATE": 6.0,
                "HIGH": 12.0,
            },
        },
        "BALLAST_TANK": {
            "class_weights": {
                "light_rust": 1.12,
                "moderate_rust": 1.20,
                "heavy_rust": 1.28,
                "coating_breakdown": 1.28,
                "pitting": 1.36,
                "stain_or_false_positive": 0.00,
            },
            "severity_thresholds": {
                "LOW": 2.0,
                "MODERATE": 5.0,
                "HIGH": 10.0,
            },
        },
        "CARGO_TANK": {
            "class_weights": {
                "light_rust": 1.05,
                "moderate_rust": 1.10,
                "heavy_rust": 1.16,
                "coating_breakdown": 1.20,
                "pitting": 1.25,
                "stain_or_false_positive": 0.00,
            },
            "severity_thresholds": {
                "LOW": 3.0,
                "MODERATE": 7.0,
                "HIGH": 13.0,
            },
        },
    }

    return table.get(area_type, defaults)


def _resize_if_needed(bgr: np.ndarray, max_side: int) -> np.ndarray:
    h, w = bgr.shape[:2]
    m = max(h, w)
    if m <= max_side:
        return bgr
    scale = max_side / float(m)
    new_w = int(w * scale)
    new_h = int(h * scale)
    return cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _apply_clahe_on_l_channel(
    bgr: np.ndarray,
    clip_limit: float = 2.0,
    tile_grid: Tuple[int, int] = (8, 8),
) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid)
    l2 = clahe.apply(l)
    lab2 = cv2.merge((l2, a, b))
    return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)


def _circular_hue_distance(h1: np.ndarray, h2: float) -> np.ndarray:
    d = np.abs(h1.astype(np.float32) - float(h2))
    return np.minimum(d, 180.0 - d)


def _estimate_dominant_coating_color_cargo_hold(bgr: np.ndarray) -> Dict[str, float]:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)

    h, w = bgr.shape[:2]
    y1 = int(h * 0.12)
    y2 = int(h * 0.72)
    x1 = int(w * 0.08)
    x2 = int(w * 0.92)

    hsv_roi = hsv[y1:y2, x1:x2]
    lab_roi = lab[y1:y2, x1:x2]

    H = hsv_roi[:, :, 0]
    S = hsv_roi[:, :, 1]
    V = hsv_roi[:, :, 2]

    L = lab_roi[:, :, 0]
    A = lab_roi[:, :, 1]
    B = lab_roi[:, :, 2]

    valid = (
        (V > 40) &
        (V < 235) &
        (S > 45) &
        (S < 220)
    )

    if np.count_nonzero(valid) < 500:
        return {
            "h": 12.0,
            "s": 120.0,
            "l": 140.0,
            "a": 150.0,
            "b": 150.0,
        }

    return {
        "h": float(np.median(H[valid])),
        "s": float(np.median(S[valid])),
        "l": float(np.median(L[valid])),
        "a": float(np.median(A[valid])),
        "b": float(np.median(B[valid])),
    }


def _cargo_hold_coating_reject_mask(
    bgr: np.ndarray,
    rust_mask: np.ndarray,
    gray: np.ndarray,
    cfg: RustConfig,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    if np.count_nonzero(rust_mask) == 0:
        return rust_mask, {"note": "empty_mask"}

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)

    coating = _estimate_dominant_coating_color_cargo_hold(bgr)

    H = hsv[:, :, 0].astype(np.float32)
    S = hsv[:, :, 1].astype(np.float32)
    A = lab[:, :, 1].astype(np.float32)
    B = lab[:, :, 2].astype(np.float32)

    hue_dist = _circular_hue_distance(H, coating["h"])
    sat_dist = np.abs(S - coating["s"])
    lab_dist = np.sqrt((A - coating["a"]) ** 2 + (B - coating["b"]) ** 2)

    edges = cv2.Canny(gray, 60, 140)
    edge_density_map = cv2.blur((edges > 0).astype(np.float32), (9, 9))

    reject_like_coating = (
        (hue_dist <= cfg.coating_hue_dist_reject) &
        (sat_dist <= cfg.coating_sat_diff_reject) &
        (lab_dist <= cfg.coating_lab_dist_reject) &
        (edge_density_map < cfg.edge_keep_override)
    )

    out = rust_mask.copy()
    out[reject_like_coating & (rust_mask > 0)] = 0

    debug = {
        "dominant_coating": {
            "h": round(coating["h"], 2),
            "s": round(coating["s"], 2),
            "l": round(coating["l"], 2),
            "a": round(coating["a"], 2),
            "b": round(coating["b"], 2),
        },
        "coating_reject": {
            "coating_lab_dist_reject": cfg.coating_lab_dist_reject,
            "coating_hue_dist_reject": cfg.coating_hue_dist_reject,
            "coating_sat_diff_reject": cfg.coating_sat_diff_reject,
            "edge_keep_override": cfg.edge_keep_override,
            "rejected_pixels": int(np.count_nonzero((rust_mask > 0) & reject_like_coating)),
        },
    }
    return out, debug


def _morph_cleanup(mask: np.ndarray, cfg: RustConfig) -> np.ndarray:
    if cfg.open_ksize > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg.open_ksize, cfg.open_ksize))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)

    if cfg.close_ksize > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg.close_ksize, cfg.close_ksize))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)

    return mask


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    out = np.zeros_like(mask)
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= min_area:
            out[labels == i] = 255
    return out


def _severity_from_pct(rust_pct_total: float, thresholds: Dict[str, float]) -> str:
    low = float(thresholds.get("LOW", 3.0))
    moderate = float(thresholds.get("MODERATE", 8.0))
    high = float(thresholds.get("HIGH", 15.0))

    if rust_pct_total <= low:
        return "LOW"
    if rust_pct_total <= moderate:
        return "MODERATE"
    if rust_pct_total <= high:
        return "HIGH"
    return "SEVERE"


def _confidence_estimate(mask: np.ndarray, hsv: np.ndarray, gray: np.ndarray) -> float:
    rust_pixels = int(np.count_nonzero(mask))
    total_pixels = int(mask.size)
    if total_pixels == 0:
        return 0.0
    if rust_pixels == 0:
        return 0.10

    pct = rust_pixels / total_pixels
    s = hsv[:, :, 1]
    sat_mean = float(np.mean(s[mask > 0])) if rust_pixels > 0 else 0.0
    vals = gray[mask > 0]
    tex_std = float(np.std(vals)) if vals.size > 0 else 0.0

    sat_norm = min(max(sat_mean / 255.0, 0.0), 1.0)
    pct_norm = min(max(np.sqrt(pct), 0.0), 1.0)
    tex_norm = min(max(tex_std / 64.0, 0.0), 1.0)

    conf = 0.15 + 0.40 * pct_norm + 0.25 * sat_norm + 0.20 * tex_norm
    return float(min(max(conf, 0.0), 1.0))


def _component_features(
    labels: np.ndarray,
    stats: np.ndarray,
    idx: int,
    hsv: np.ndarray,
    gray: np.ndarray,
) -> Dict[str, float]:
    x = int(stats[idx, cv2.CC_STAT_LEFT])
    y = int(stats[idx, cv2.CC_STAT_TOP])
    w = int(stats[idx, cv2.CC_STAT_WIDTH])
    h = int(stats[idx, cv2.CC_STAT_HEIGHT])
    area = int(stats[idx, cv2.CC_STAT_AREA])

    comp_mask = labels == idx
    ys, xs = np.where(comp_mask)
    if xs.size == 0 or ys.size == 0:
        return {
            "area": float(area),
            "mean_sat": 0.0,
            "std_gray": 0.0,
            "fill_ratio": 0.0,
            "aspect_ratio": 999.0,
            "edge_density": 0.0,
        }

    mean_sat = float(np.mean(hsv[:, :, 1][comp_mask]))
    std_gray = float(np.std(gray[comp_mask]))
    box_area = max(1, w * h)
    fill_ratio = float(area) / float(box_area)
    aspect_ratio = float(max(w, h)) / float(max(1, min(w, h)))

    crop = gray[y:y + h, x:x + w]
    edges = cv2.Canny(crop, 60, 140)
    edge_density = float(np.count_nonzero(edges)) / float(max(1, box_area))

    return {
        "area": float(area),
        "mean_sat": mean_sat,
        "std_gray": std_gray,
        "fill_ratio": fill_ratio,
        "aspect_ratio": aspect_ratio,
        "edge_density": edge_density,
        "x": float(x),
        "y": float(y),
        "w": float(w),
        "h": float(h),
    }


def _reject_components(
    mask: np.ndarray,
    hsv: np.ndarray,
    gray: np.ndarray,
    cfg: RustConfig,
) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask, []

    out = np.zeros_like(mask)
    rejected: List[Dict[str, Any]] = []

    for i in range(1, num_labels):
        feats = _component_features(labels, stats, i, hsv, gray)
        reject_reasons: List[str] = []

        if feats["area"] < cfg.min_component_area_px:
            reject_reasons.append("small_area")
        if feats["mean_sat"] < cfg.low_sat_reject:
            reject_reasons.append("low_saturation")
        if feats["std_gray"] < cfg.smooth_std_reject:
            reject_reasons.append("too_smooth")
        if feats["fill_ratio"] < cfg.min_fill_ratio:
            reject_reasons.append("low_fill_ratio")
        if feats["aspect_ratio"] > cfg.max_aspect_ratio:
            reject_reasons.append("extreme_aspect_ratio")
        if (
            feats["area"] > cfg.large_area_px
            and feats["fill_ratio"] > cfg.max_fill_ratio_for_large_area
            and feats["std_gray"] < (cfg.smooth_std_reject + 4.0)
        ):
            reject_reasons.append("large_solid_region")
        if feats["std_gray"] < cfg.smooth_std_reject and feats["edge_density"] < cfg.edge_density_reject:
            reject_reasons.append("low_texture_low_edges")

        if reject_reasons:
            rejected.append({
                "label_id": i,
                "reasons": reject_reasons,
                "features": {k: round(v, 4) for k, v in feats.items()},
            })
            continue

        out[labels == i] = 255

    return out, rejected


def _overlay_from_mask(bgr: np.ndarray, rust_mask: np.ndarray) -> np.ndarray:
    overlay = bgr.copy()
    rust_region = rust_mask > 0

    red = np.zeros_like(overlay)
    red[:, :] = (0, 0, 255)
    alpha = 0.35

    overlay[rust_region] = cv2.addWeighted(
        overlay[rust_region], 1 - alpha, red[rust_region], alpha, 0
    )

    contours, _ = cv2.findContours(rust_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay, contours, -1, (0, 255, 255), 2)
    return overlay


def _area_specific_thresholds(cfg: RustConfig) -> RustConfig:
    area = cfg.area_type.upper()

    if area == "BALLAST_TANK":
        cfg.hsv_low = (6, 70, 25)
        cfg.hsv_high = (24, 255, 255)
        cfg.hsv_low_2 = (0, 60, 12)
        cfg.hsv_high_2 = (12, 255, 125)

        cfg.open_ksize = 3
        cfg.close_ksize = 9
        cfg.min_component_area_px = 900

        cfg.heavy_v_max = 75
        cfg.moderate_v_max = 135

        cfg.glare_v_min = 220
        cfg.glare_s_max = 30

        cfg.low_sat_reject = 60
        cfg.smooth_std_reject = 14.0
        cfg.min_fill_ratio = 0.11
        cfg.max_aspect_ratio = 10.0

        cfg.max_fill_ratio_for_large_area = 0.45
        cfg.large_area_px = 30000
        cfg.edge_density_reject = 0.012

        cfg.apply_clahe = True
        cfg.clahe_clip_limit = 2.5
        cfg.clahe_tile_grid = (8, 8)

    elif area == "VOID_SPACE":
        cfg.hsv_low = (6, 68, 24)
        cfg.hsv_high = (24, 255, 255)
        cfg.hsv_low_2 = (0, 58, 12)
        cfg.hsv_high_2 = (12, 255, 128)

        cfg.open_ksize = 3
        cfg.close_ksize = 9
        cfg.min_component_area_px = 800

        cfg.heavy_v_max = 78
        cfg.moderate_v_max = 140

        cfg.glare_v_min = 220
        cfg.glare_s_max = 30

        cfg.low_sat_reject = 58
        cfg.smooth_std_reject = 14.0
        cfg.min_fill_ratio = 0.10
        cfg.max_aspect_ratio = 10.0

        cfg.max_fill_ratio_for_large_area = 0.45
        cfg.large_area_px = 28000
        cfg.edge_density_reject = 0.012

        cfg.apply_clahe = True
        cfg.clahe_clip_limit = 2.4
        cfg.clahe_tile_grid = (8, 8)

    elif area == "MAIN_DECK":
        cfg.hsv_low = (7, 68, 35)
        cfg.hsv_high = (26, 255, 255)
        cfg.hsv_low_2 = (0, 55, 18)
        cfg.hsv_high_2 = (12, 255, 138)

        cfg.open_ksize = 3
        cfg.close_ksize = 7
        cfg.min_component_area_px = 650

        cfg.heavy_v_max = 82
        cfg.moderate_v_max = 150

        cfg.glare_v_min = 230
        cfg.glare_s_max = 32

        cfg.low_sat_reject = 50
        cfg.smooth_std_reject = 12.0
        cfg.min_fill_ratio = 0.08
        cfg.max_aspect_ratio = 12.0

        cfg.max_fill_ratio_for_large_area = 0.50
        cfg.large_area_px = 35000
        cfg.edge_density_reject = 0.010

        cfg.apply_clahe = False

    elif area == "CARGO_HOLD":
        cfg.hsv_low = (7, 72, 24)
        cfg.hsv_high = (23, 255, 218)
        cfg.hsv_low_2 = (2, 58, 10)
        cfg.hsv_high_2 = (12, 255, 110)

        cfg.open_ksize = 3
        cfg.close_ksize = 3
        cfg.min_component_area_px = 90

        cfg.heavy_v_max = 78
        cfg.moderate_v_max = 145

        cfg.glare_v_min = 220
        cfg.glare_s_max = 28

        cfg.low_sat_reject = 64
        cfg.smooth_std_reject = 14.5
        cfg.min_fill_ratio = 0.015
        cfg.max_aspect_ratio = 14.0

        cfg.max_fill_ratio_for_large_area = 0.34
        cfg.large_area_px = 18000
        cfg.edge_density_reject = 0.008

        cfg.cargo_hold_use_coating_reject = True
        cfg.coating_lab_dist_reject = 18.0
        cfg.coating_hue_dist_reject = 8
        cfg.coating_sat_diff_reject = 35
        cfg.edge_keep_override = 0.035

        cfg.apply_clahe = False

    elif area == "CARGO_TANK":
        cfg.hsv_low = (6, 66, 24)
        cfg.hsv_high = (24, 255, 255)
        cfg.hsv_low_2 = (0, 58, 12)
        cfg.hsv_high_2 = (12, 255, 125)

        cfg.open_ksize = 3
        cfg.close_ksize = 9
        cfg.min_component_area_px = 850

        cfg.heavy_v_max = 78
        cfg.moderate_v_max = 140

        cfg.glare_v_min = 222
        cfg.glare_s_max = 30

        cfg.low_sat_reject = 58
        cfg.smooth_std_reject = 14.0
        cfg.min_fill_ratio = 0.10
        cfg.max_aspect_ratio = 10.0

        cfg.max_fill_ratio_for_large_area = 0.45
        cfg.large_area_px = 30000
        cfg.edge_density_reject = 0.012

        cfg.apply_clahe = True
        cfg.clahe_clip_limit = 2.4
        cfg.clahe_tile_grid = (8, 8)

    return cfg


_MODEL_CACHE: Dict[str, Any] = {}


def _get_model(model_path: str):
    if YOLO is None:
        raise RuntimeError("ultralytics is not installed")
    if not model_path:
        raise RuntimeError("model_path is required for model analyzer mode")
    if model_path not in _MODEL_CACHE:
        _MODEL_CACHE[model_path] = YOLO(model_path)
    return _MODEL_CACHE[model_path]


def _analyze_with_model(bgr: np.ndarray, cfg: RustConfig) -> Tuple[RustResult, np.ndarray, np.ndarray]:
    model = _get_model(cfg.model_path or "")
    calibration = get_area_calibration(cfg.area_type)
    class_weights = calibration["class_weights"]
    severity_thresholds = calibration["severity_thresholds"]

    image = _resize_if_needed(bgr, cfg.max_side)
    if cfg.apply_clahe and cfg.area_type in {"BALLAST_TANK", "VOID_SPACE", "CARGO_TANK"}:
        image = _apply_clahe_on_l_channel(image, cfg.clahe_clip_limit, cfg.clahe_tile_grid)

    h, w = image.shape[:2]
    total_px = float(max(1, h * w))

    results = model.predict(
        source=cv2.cvtColor(image, cv2.COLOR_BGR2RGB),
        conf=cfg.model_conf,
        imgsz=cfg.model_imgsz,
        retina_masks=True,
        verbose=False,
    )

    if not results:
        empty = np.zeros((h, w), dtype=np.uint8)
        return RustResult(
            rust_pct_total=0.0,
            rust_pct_light=0.0,
            rust_pct_moderate=0.0,
            rust_pct_heavy=0.0,
            severity="LOW",
            confidence=0.0,
            debug={"mode": "model", "note": "no results"},
        ), empty, image.copy()

    r = results[0]
    if r.masks is None or r.boxes is None or len(r.boxes) == 0:
        empty = np.zeros((h, w), dtype=np.uint8)
        return RustResult(
            rust_pct_total=0.0,
            rust_pct_light=0.0,
            rust_pct_moderate=0.0,
            rust_pct_heavy=0.0,
            severity="LOW",
            confidence=0.0,
            debug={"mode": "model", "note": "no masks"},
        ), empty, image.copy()

    class_ids = r.boxes.cls.cpu().numpy().astype(int)
    confs = r.boxes.conf.cpu().numpy().astype(float)
    masks = r.masks.data.cpu().numpy()

    class_px: Dict[str, float] = {name: 0.0 for name in CLASS_ID_TO_NAME.values()}
    class_conf_sum: Dict[str, float] = {name: 0.0 for name in CLASS_ID_TO_NAME.values()}
    class_count: Dict[str, int] = {name: 0 for name in CLASS_ID_TO_NAME.values()}
    union_mask = np.zeros((h, w), dtype=np.uint8)

    for i in range(len(class_ids)):
        cls_id = int(class_ids[i])
        cls_name = CLASS_ID_TO_NAME.get(cls_id, f"class_{cls_id}")
        conf = float(confs[i])

        mask = masks[i]
        mask = cv2.resize(mask.astype(np.float32), (w, h), interpolation=cv2.INTER_NEAREST)
        mask = (mask > 0.5).astype(np.uint8)

        px = float(np.count_nonzero(mask))
        class_px[cls_name] = class_px.get(cls_name, 0.0) + px
        class_conf_sum[cls_name] = class_conf_sum.get(cls_name, 0.0) + conf
        class_count[cls_name] = class_count.get(cls_name, 0) + 1

        if class_weights.get(cls_name, 0.0) > 0:
            union_mask = np.maximum(union_mask, mask)

    raw_pct = {k: (v / total_px) * 100.0 for k, v in class_px.items()}
    calibrated_pct = {
        k: raw_pct.get(k, 0.0) * float(class_weights.get(k, 0.0))
        for k in raw_pct
    }

    rust_pct_light = float(round(calibrated_pct.get("light_rust", 0.0), 3))
    rust_pct_moderate = float(round(calibrated_pct.get("moderate_rust", 0.0), 3))
    rust_pct_heavy = float(round(calibrated_pct.get("heavy_rust", 0.0), 3))
    coating_failure_pct = float(round(
        calibrated_pct.get("coating_breakdown", 0.0) + calibrated_pct.get("pitting", 0.0),
        3
    ))

    rust_pct_total = float(round(
        rust_pct_light + rust_pct_moderate + rust_pct_heavy + coating_failure_pct,
        3
    ))

    valid_conf = [
        class_conf_sum[k] / class_count[k]
        for k in class_count
        if class_count[k] > 0 and class_weights.get(k, 0.0) > 0
    ]
    confidence = float(round(float(np.mean(valid_conf)), 3)) if valid_conf else 0.0

    severity = _severity_from_pct(rust_pct_total, severity_thresholds)
    overlay = _overlay_from_mask(image, (union_mask * 255).astype(np.uint8))

    debug = {
        "mode": "model",
        "area_type": cfg.area_type,
        "image_shape": bgr.shape[:2],
        "analyzed_shape": image.shape[:2],
        "model_path": cfg.model_path,
        "raw_pct_by_class": {k: round(v, 3) for k, v in raw_pct.items()},
        "calibrated_pct_by_class": {k: round(v, 3) for k, v in calibrated_pct.items()},
        "class_instance_count": class_count,
        "severity_thresholds": severity_thresholds,
    }

    result = RustResult(
        rust_pct_total=rust_pct_total,
        rust_pct_light=rust_pct_light,
        rust_pct_moderate=rust_pct_moderate,
        rust_pct_heavy=rust_pct_heavy,
        severity=severity,
        confidence=confidence,
        debug=debug,
    )
    return result, (union_mask * 255).astype(np.uint8), overlay


def _analyze_with_heuristic(bgr: np.ndarray, cfg: RustConfig) -> Tuple[RustResult, np.ndarray, np.ndarray]:
    cfg = _area_specific_thresholds(cfg)
    calibration = get_area_calibration(cfg.area_type)
    severity_thresholds = calibration["severity_thresholds"]

    bgr0 = _resize_if_needed(bgr, cfg.max_side)

    if cfg.apply_clahe and cfg.area_type in {"BALLAST_TANK", "VOID_SPACE", "CARGO_TANK"}:
        bgr1 = _apply_clahe_on_l_channel(bgr0, cfg.clahe_clip_limit, cfg.clahe_tile_grid)
    else:
        bgr1 = bgr0.copy()

    hsv = cv2.cvtColor(bgr1, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(bgr1, cv2.COLOR_BGR2GRAY)

    mask1 = cv2.inRange(
        hsv,
        np.array(cfg.hsv_low, dtype=np.uint8),
        np.array(cfg.hsv_high, dtype=np.uint8),
    )
    mask2 = cv2.inRange(
        hsv,
        np.array(cfg.hsv_low_2, dtype=np.uint8),
        np.array(cfg.hsv_high_2, dtype=np.uint8),
    )

    rust_mask = cv2.bitwise_or(mask1, mask2)

    h, s, v = cv2.split(hsv)

    glare = ((v >= cfg.glare_v_min) & (s <= cfg.glare_s_max)).astype(np.uint8) * 255
    rust_mask[glare > 0] = 0

    low_sat = (s < cfg.low_sat_reject).astype(np.uint8) * 255
    rust_mask[low_sat > 0] = 0

    rust_mask = _morph_cleanup(rust_mask, cfg)
    rust_mask = _remove_small_components(rust_mask, cfg.min_component_area_px)

    rust_mask, rejected_components = _reject_components(rust_mask, hsv, gray, cfg)

    cargo_hold_coating_debug: Dict[str, Any] = {}
    if cfg.area_type == "CARGO_HOLD" and cfg.cargo_hold_use_coating_reject:
        rust_mask, cargo_hold_coating_debug = _cargo_hold_coating_reject_mask(
            bgr=bgr1,
            rust_mask=rust_mask,
            gray=gray,
            cfg=cfg,
        )

    rust_mask = _morph_cleanup(rust_mask, cfg)
    rust_mask = _remove_small_components(rust_mask, cfg.min_component_area_px)

    total_px = float(max(1, rust_mask.size))
    rust_region = rust_mask > 0
    rust_px = float(np.count_nonzero(rust_region))
    raw_rust_pct_total = (rust_px / total_px) * 100.0

    heavy_region = rust_region & (v <= cfg.heavy_v_max)
    moderate_region = rust_region & (v > cfg.heavy_v_max) & (v <= cfg.moderate_v_max)
    light_region = rust_region & (v > cfg.moderate_v_max)

    raw_heavy = (float(np.count_nonzero(heavy_region)) / total_px) * 100.0
    raw_moderate = (float(np.count_nonzero(moderate_region)) / total_px) * 100.0
    raw_light = (float(np.count_nonzero(light_region)) / total_px) * 100.0

    weights = calibration["class_weights"]
    rust_pct_light = raw_light * float(weights.get("light_rust", 1.0))
    rust_pct_moderate = raw_moderate * float(weights.get("moderate_rust", 1.0))
    rust_pct_heavy = raw_heavy * float(weights.get("heavy_rust", 1.0))

    rust_pct_total = rust_pct_light + rust_pct_moderate + rust_pct_heavy
    severity = _severity_from_pct(rust_pct_total, severity_thresholds)
    confidence = _confidence_estimate(rust_mask, hsv, gray)

    overlay = _overlay_from_mask(bgr0, rust_mask)

    debug = {
        "mode": "heuristic",
        "area_type": cfg.area_type,
        "image_shape": bgr.shape[:2],
        "analyzed_shape": bgr0.shape[:2],
        "raw_rust_pct_total": round(raw_rust_pct_total, 3),
        "raw_light": round(raw_light, 3),
        "raw_moderate": round(raw_moderate, 3),
        "raw_heavy": round(raw_heavy, 3),
        "thresholds": {
            "hsv_low": cfg.hsv_low,
            "hsv_high": cfg.hsv_high,
            "hsv_low_2": cfg.hsv_low_2,
            "hsv_high_2": cfg.hsv_high_2,
            "heavy_v_max": cfg.heavy_v_max,
            "moderate_v_max": cfg.moderate_v_max,
            "low_sat_reject": cfg.low_sat_reject,
        },
        "glare_filter": {
            "v_min": cfg.glare_v_min,
            "s_max": cfg.glare_s_max,
        },
        "morph": {
            "open_ksize": cfg.open_ksize,
            "close_ksize": cfg.close_ksize,
        },
        "component_filters": {
            "min_component_area_px": cfg.min_component_area_px,
            "smooth_std_reject": cfg.smooth_std_reject,
            "min_fill_ratio": cfg.min_fill_ratio,
            "max_aspect_ratio": cfg.max_aspect_ratio,
            "max_fill_ratio_for_large_area": cfg.max_fill_ratio_for_large_area,
            "large_area_px": cfg.large_area_px,
            "edge_density_reject": cfg.edge_density_reject,
        },
        "clahe": {
            "applied": bool(cfg.apply_clahe and cfg.area_type in {"BALLAST_TANK", "VOID_SPACE", "CARGO_TANK"}),
            "clip_limit": cfg.clahe_clip_limit,
            "tile_grid": cfg.clahe_tile_grid,
        },
        "severity_thresholds": severity_thresholds,
        "rejected_components_count": len(rejected_components),
        "rejected_components_preview": rejected_components[:20],
        "cargo_hold_coating_debug": cargo_hold_coating_debug,
    }

    result = RustResult(
        rust_pct_total=float(round(rust_pct_total, 3)),
        rust_pct_light=float(round(rust_pct_light, 3)),
        rust_pct_moderate=float(round(rust_pct_moderate, 3)),
        rust_pct_heavy=float(round(rust_pct_heavy, 3)),
        severity=severity,
        confidence=float(round(confidence, 3)),
        debug=debug,
    )

    return result, rust_mask, overlay


def analyze_rust_bgr(
    bgr: np.ndarray,
    cfg: Optional[RustConfig] = None,
) -> Tuple[RustResult, np.ndarray, np.ndarray]:
    """
    Returns:
      - RustResult
      - rust_mask (uint8, 0/255)
      - overlay_bgr
    """
    cfg = cfg or RustConfig()

    area_type = (cfg.area_type or "MAIN_DECK").strip().upper()
    if area_type not in AREA_TYPES:
        area_type = "MAIN_DECK"
    cfg.area_type = area_type

    area_cal = get_area_calibration(area_type)
    cfg.class_weights = area_cal["class_weights"]
    cfg.severity_thresholds = area_cal["severity_thresholds"]

    mode = (cfg.analyzer_mode or "auto").strip().lower()

    if mode == "model":
        return _analyze_with_model(bgr, cfg)

    if mode == "heuristic":
        return _analyze_with_heuristic(bgr, cfg)

    if cfg.model_path and YOLO is not None:
        try:
            return _analyze_with_model(bgr, cfg)
        except Exception as e:
            result, mask, overlay = _analyze_with_heuristic(bgr, cfg)
            result.debug["fallback_reason"] = str(e)
            return result, mask, overlay

    return _analyze_with_heuristic(bgr, cfg)