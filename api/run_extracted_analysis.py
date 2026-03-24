from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Any, List, Optional

import cv2

from rust_analyzer import analyze_rust_bgr, RustConfig


VALID_AREAS = {
    "CARGO_HOLD",
    "MAIN_DECK",
    "VOID_SPACE",
    "BALLAST_TANK",
    "CARGO_TANK",
}


def _safe_area(area_type: Optional[str]) -> str:
    area = (area_type or "MAIN_DECK").strip().upper()
    return area if area in VALID_AREAS else "MAIN_DECK"


def _iter_image_files(folder: str) -> List[str]:
    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    out: List[str] = []

    root = Path(folder)
    if not root.exists():
        raise FileNotFoundError(f"Folder not found: {folder}")

    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in exts:
            out.append(str(p))

    out.sort()
    return out


def _build_overlay_and_mask_paths(image_path: str, output_dir: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not output_dir:
        return None, None

    out_root = Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    stem = Path(image_path).stem
    overlay_path = out_root / f"{stem}_overlay.png"
    mask_path = out_root / f"{stem}_mask.png"
    return str(overlay_path), str(mask_path)


def analyze_image_file(
    image_path: str,
    area_type: str,
    output_dir: Optional[str] = None,
) -> Dict[str, Any]:
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")

    result, rust_mask, overlay = analyze_rust_bgr(
        img,
        RustConfig(
            area_type=_safe_area(area_type),
            analyzer_mode="heuristic",
        ),
    )

    overlay_path, mask_path = _build_overlay_and_mask_paths(image_path, output_dir)

    if overlay_path:
        cv2.imwrite(overlay_path, overlay)
    if mask_path:
        cv2.imwrite(mask_path, rust_mask)

    return {
        "image_name": Path(image_path).name,
        "image_path": image_path,
        "area_type": _safe_area(area_type),
        "rust_pct": float(result.rust_pct_total),
        "rust_pct_light": float(result.rust_pct_light),
        "rust_pct_moderate": float(result.rust_pct_moderate),
        "rust_pct_heavy": float(result.rust_pct_heavy),
        "severity": result.severity,
        "confidence": float(result.confidence),
        "overlay_path": overlay_path,
        "mask_path": mask_path,
        "debug": result.debug,
    }


def run_batch_rust_analysis(
    extracted_dir: str,
    area_type: str,
    output_dir: Optional[str] = None,
) -> Dict[str, Any]:
    image_files = _iter_image_files(extracted_dir)
    if not image_files:
        return {
            "ok": False,
            "message": "No image files found",
            "results": [],
            "image_count": 0,
            "avg_rust_pct": 0.0,
            "max_rust_pct": 0.0,
        }

    results: List[Dict[str, Any]] = []
    failed: List[Dict[str, str]] = []

    for image_path in image_files:
        try:
            analyzed = analyze_image_file(
                image_path=image_path,
                area_type=area_type,
                output_dir=output_dir,
            )
            results.append(analyzed)
        except Exception as e:
            failed.append({
                "image_path": image_path,
                "error": str(e),
            })

    rust_values = [float(x["rust_pct"]) for x in results]
    avg_rust = round(sum(rust_values) / len(rust_values), 3) if rust_values else 0.0
    max_rust = round(max(rust_values), 3) if rust_values else 0.0

    return {
        "ok": True,
        "message": "Batch analysis complete",
        "area_type": _safe_area(area_type),
        "image_count": len(results),
        "avg_rust_pct": avg_rust,
        "max_rust_pct": max_rust,
        "results": results,
        "failed": failed,
    }


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Run batch rust analysis on extracted images")
    parser.add_argument("--input", required=True, help="Folder containing extracted images")
    parser.add_argument("--area", required=True, help="Area type, e.g. CARGO_HOLD")
    parser.add_argument("--output", default=None, help="Folder to save overlay/mask previews")
    args = parser.parse_args()

    summary = run_batch_rust_analysis(
        extracted_dir=args.input,
        area_type=args.area,
        output_dir=args.output,
    )

    print(json.dumps(summary, indent=2))