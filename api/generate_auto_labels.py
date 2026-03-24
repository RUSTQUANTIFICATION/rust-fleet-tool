from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Tuple, Optional

import cv2
import numpy as np

from rust_analyzer import analyze_rust_bgr, RustConfig


VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

AREA_KEYWORDS = {
    "BALLAST_TANK": ["ballast_tank", "ballast tank", "ballast"],
    "VOID_SPACE": ["void_space", "void space", "void"],
    "CARGO_TANK": ["cargo_tank", "cargo tank", "cargotank"],
    "CARGO_HOLD": ["cargo_hold", "cargo hold", "hold"],
    "MAIN_DECK": ["main_deck", "main deck", "deck"],
}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def find_images(folder: Path) -> List[Path]:
    if not folder.exists():
        return []
    return sorted([p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in VALID_EXTS])


def detect_area_type(image_path: Path, fallback: str = "MAIN_DECK") -> str:
    """
    Detect area type from full path and file name.
    Priority order matters:
    BALLAST_TANK / VOID_SPACE / CARGO_TANK / CARGO_HOLD / MAIN_DECK
    """
    text = str(image_path).replace("\\", "/").lower()

    for area_type, keywords in AREA_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                return area_type

    return fallback.upper()


def contour_to_yolo_polygon(
    contour: np.ndarray,
    img_w: int,
    img_h: int,
) -> List[float]:
    pts = contour.reshape(-1, 2)
    coords: List[float] = []

    for x, y in pts:
        xn = min(max(float(x) / float(img_w), 0.0), 1.0)
        yn = min(max(float(y) / float(img_h), 0.0), 1.0)
        coords.extend([xn, yn])

    return coords


def simplify_contour(contour: np.ndarray, epsilon_ratio: float = 0.003) -> np.ndarray:
    peri = cv2.arcLength(contour, True)
    epsilon = epsilon_ratio * peri
    return cv2.approxPolyDP(contour, epsilon, True)


def mask_to_yolo_segments(
    mask: np.ndarray,
    img_w: int,
    img_h: int,
    class_id: int = 0,
    min_area: int = 300,
) -> List[str]:
    lines: List[str] = []

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        contour = simplify_contour(contour)

        if contour.shape[0] < 3:
            continue

        poly = contour_to_yolo_polygon(contour, img_w, img_h)
        if len(poly) < 6:
            continue

        line = str(class_id) + " " + " ".join(f"{v:.6f}" for v in poly)
        lines.append(line)

    return lines


def save_preview(
    preview_dir: Path,
    image_path: Path,
    overlay_bgr: np.ndarray,
    mask: np.ndarray,
    area_type: str,
) -> None:
    ensure_dir(preview_dir)

    stem = image_path.stem
    overlay_path = preview_dir / f"{stem}_{area_type.lower()}_overlay.jpg"
    mask_path = preview_dir / f"{stem}_{area_type.lower()}_mask.png"

    cv2.imwrite(str(overlay_path), overlay_bgr)
    cv2.imwrite(str(mask_path), mask)


def process_split(
    split: str,
    images_dir: Path,
    labels_dir: Path,
    preview_dir: Path,
    class_id: int,
    min_area: int,
    overwrite: bool,
    fallback_area_type: str,
) -> Tuple[int, int]:
    ensure_dir(labels_dir)
    ensure_dir(preview_dir)

    images = find_images(images_dir)

    written = 0
    skipped = 0

    print(f"\nProcessing split: {split}")
    print(f"Images folder: {images_dir}")
    print(f"Labels folder: {labels_dir}")
    print(f"Found {len(images)} images")

    for idx, img_path in enumerate(images, start=1):
        label_path = labels_dir / f"{img_path.stem}.txt"

        if label_path.exists() and not overwrite:
            skipped += 1
            print(f"[{idx}] Skip existing: {img_path.name}")
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            skipped += 1
            print(f"[{idx}] ERROR reading image: {img_path.name}")
            continue

        area_type = detect_area_type(img_path, fallback=fallback_area_type)

        try:
            result, rust_mask, overlay = analyze_rust_bgr(
                img,
                RustConfig(
                    area_type=area_type,
                    analyzer_mode="heuristic",
                ),
            )
            print("DEBUG:", result.debug)
            h, w = img.shape[:2]
            lines = mask_to_yolo_segments(
                rust_mask,
                img_w=w,
                img_h=h,
                class_id=class_id,
                min_area=min_area,
            )

            label_path.write_text("\n".join(lines), encoding="utf-8")

            save_preview(preview_dir, img_path, overlay, rust_mask, area_type)

            written += 1
            print(
                f"[{idx}] OK {img_path.name} | area={area_type} | "
                f"rust={result.rust_pct_total:.2f}% | severity={result.severity} | labels={len(lines)}"
            )

        except Exception as e:
            skipped += 1
            print(f"[{idx}] ERROR {img_path.name} | area={area_type}: {e}")

    return written, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-generate YOLO segmentation labels from rust masks")
    parser.add_argument(
        "--dataset-root",
        default="../datasets/marine_rust_seg",
        help="Path to marine_rust_seg dataset root, relative to api folder",
    )
    parser.add_argument(
        "--class-id",
        type=int,
        default=0,
        help="YOLO class id to assign to generated masks",
    )
    parser.add_argument(
        "--min-area",
        type=int,
        default=300,
        help="Minimum contour area in pixels to keep",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing label files",
    )
    parser.add_argument(
        "--fallback-area-type",
        default="MAIN_DECK",
        help="Used only if area type cannot be detected from folder/file name",
    )

    args = parser.parse_args()

    dataset_root = Path(args.dataset_root).resolve()
    images_train = dataset_root / "images" / "train"
    images_val = dataset_root / "images" / "val"
    labels_train = dataset_root / "labels" / "train"
    labels_val = dataset_root / "labels" / "val"
    previews_root = dataset_root / "previews"
    preview_train = previews_root / "train"
    preview_val = previews_root / "val"

    ensure_dir(labels_train)
    ensure_dir(labels_val)
    ensure_dir(preview_train)
    ensure_dir(preview_val)

    print("Dataset root:", dataset_root)
    print("Class ID:", args.class_id)
    print("Fallback area type:", args.fallback_area_type)

    train_written, train_skipped = process_split(
        split="train",
        images_dir=images_train,
        labels_dir=labels_train,
        preview_dir=preview_train,
        class_id=args.class_id,
        min_area=args.min_area,
        overwrite=args.overwrite,
        fallback_area_type=args.fallback_area_type,
    )

    val_written, val_skipped = process_split(
        split="val",
        images_dir=images_val,
        labels_dir=labels_val,
        preview_dir=preview_val,
        class_id=args.class_id,
        min_area=args.min_area,
        overwrite=args.overwrite,
        fallback_area_type=args.fallback_area_type,
    )

    print("\nDone.")
    print(f"Train: written={train_written}, skipped={train_skipped}")
    print(f"Val:   written={val_written}, skipped={val_skipped}")
    print(f"Preview images saved under: {previews_root}")


if __name__ == "__main__":
    main()