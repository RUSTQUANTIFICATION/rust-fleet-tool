import os
import io
from pathlib import Path

import cv2
import numpy as np
import requests
from PIL import Image
from dotenv import load_dotenv
from supabase import create_client, Client
from rust_analyzer import analyze_rust_bgr, RustConfig

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
PHOTOS_BUCKET = os.environ.get("PHOTOS_BUCKET", "rust-photos").strip()

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in api/.env")

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def download_image_bytes(path: str) -> bytes:
    signed = sb.storage.from_(PHOTOS_BUCKET).create_signed_url(path, 3600)
    signed_url = signed.get("signedURL") or signed.get("signedUrl")
    if not signed_url:
        raise RuntimeError(f"Could not create signed URL for {path}")

    resp = requests.get(signed_url, timeout=60)
    resp.raise_for_status()
    return resp.content


def bytes_to_bgr(blob: bytes) -> np.ndarray:
    pil = Image.open(io.BytesIO(blob)).convert("RGB")
    arr = np.array(pil)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def main():
    photos_res = (
        sb.table("inspection_photos")
        .select("id,session_id,vessel_id,area_type,location_tag,image_path,created_at")
        .order("created_at", desc=False)
        .execute()
    )

    photos = photos_res.data or []
    print(f"Found {len(photos)} photos")

    for i, p in enumerate(photos, start=1):
        photo_id = p["id"]
        area_type = (p.get("area_type") or "MAIN_DECK").strip().upper()
        image_path = p.get("image_path")

        if not image_path:
            print(f"[{i}] Skip {photo_id}: no image_path")
            continue

        try:
            blob = download_image_bytes(image_path)
            img = bytes_to_bgr(blob)

            result, mask, overlay = analyze_rust_bgr(
                img,
                RustConfig(
                    area_type=area_type,
                    analyzer_mode="heuristic",
                ),
            )

            payload = {
                "photo_id": photo_id,
                "rust_pct": float(result.rust_pct_total or 0),
                "blistering_pct": 0,
                "cracking_pct": 0,
                "coating_failure_pct": 0,
                "overall_severity": result.severity,
                "confidence": result.confidence,
                "model_version": "heuristic-v1",
                "analysis_json": {
                    "rust_pct_light": result.rust_pct_light,
                    "rust_pct_moderate": result.rust_pct_moderate,
                    "rust_pct_heavy": result.rust_pct_heavy,
                    "debug": result.debug,
                },
            }

            sb.table("photo_findings").upsert(payload, on_conflict="photo_id").execute()

            print(
                f"[{i}] OK {photo_id} | {area_type} | "
                f"rust={result.rust_pct_total:.2f}% | severity={result.severity}"
            )

        except Exception as e:
            print(f"[{i}] ERROR {photo_id}: {e}")


if __name__ == "__main__":
    main()