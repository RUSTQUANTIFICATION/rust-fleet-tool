# api/main.py
from __future__ import annotations

import base64
import io
import json
import os
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import openpyxl
import requests
from dotenv import load_dotenv
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)
from supabase import Client, create_client

from rust_analyzer import RustConfig, analyze_rust_bgr

load_dotenv()

app = FastAPI(title="Rust Fleet Analysis API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://rust-fleet-tool.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PHOTOS_BUCKET = os.environ.get("PHOTOS_BUCKET", "rust-photos")
REPORTS_BUCKET = os.environ.get("REPORTS_BUCKET", "rust-reports")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")


def supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in environment")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def upload_to_storage(path: str, content: bytes, content_type: str) -> str:
    sb = supabase()
    sb.storage.from_(PHOTOS_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return sb.storage.from_(PHOTOS_BUCKET).get_public_url(path)


def upload_report(path: str, content: bytes, content_type: str) -> str:
    sb = supabase()
    sb.storage.from_(REPORTS_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return sb.storage.from_(REPORTS_BUCKET).get_public_url(path)


def read_image_to_bgr(file_bytes: bytes) -> np.ndarray:
    npbuf = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(npbuf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Unsupported image format")
    return img


def read_storage_image_as_bgr(storage_path: str) -> np.ndarray:
    sb = supabase()
    data = sb.storage.from_(PHOTOS_BUCKET).download(storage_path)
    if not data:
        raise RuntimeError(f"Could not download image from storage path: {storage_path}")

    pil = Image.open(io.BytesIO(data)).convert("RGB")
    rgb = np.array(pil)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def encode_jpg(img_bgr: np.ndarray, quality: int = 90) -> bytes:
    ok, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Could not encode JPG")
    return buf.tobytes()


def upsert_photo_findings(
    photo_id: str,
    storage_path: str,
    marked_path: str,
    mask_path: str,
    result: Any,
) -> None:
    sb = supabase()

    raw_debug = result.debug if isinstance(result.debug, dict) else {"debug": result.debug}

    payload: Dict[str, Any] = {
        "photo_id": photo_id,
        "rust_pct_total": float(result.rust_pct_total),
        "rust_pct_light": float(result.rust_pct_light),
        "rust_pct_moderate": float(result.rust_pct_moderate),
        "rust_pct_heavy": float(result.rust_pct_heavy),
        "overall_severity": str(result.severity),
        "confidence_score": float(result.confidence),
        "analysis_status": "COMPLETED",
        "original_image_path": storage_path,
        "marked_image_path": marked_path,
        "mask_image_path": mask_path,
        "raw_warnings": raw_debug,
    }

    existing = (
        sb.from_("photo_findings")
        .select("id")
        .eq("photo_id", photo_id)
        .maybe_single()
        .execute()
    )

    existing_row = getattr(existing, "data", None)

    if existing_row and existing_row.get("id"):
        sb.from_("photo_findings").update(payload).eq("id", existing_row["id"]).execute()
    else:
        sb.from_("photo_findings").insert(payload).execute()


def analyze_rust_baseline(bgr: np.ndarray) -> Dict[str, Any]:
    if bgr is None or bgr.size == 0:
        raise ValueError("Empty image")

    h, w = bgr.shape[:2]
    if h < 50 or w < 50:
        return {
            "rust_pct_total": 0.0,
            "rust_pct_light": 0.0,
            "rust_pct_moderate": 0.0,
            "rust_pct_heavy": 0.0,
            "confidence": 0.2,
            "warnings": ["image_too_small"],
        }

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    lower1 = np.array([5, 50, 50])
    upper1 = np.array([25, 255, 255])
    mask = cv2.inRange(hsv, lower1, upper1)

    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    rust_pixels = int(np.count_nonzero(mask))
    total_pixels = int(h * w)
    rust_pct_total = (rust_pixels / total_pixels) * 100.0

    _, S, V = cv2.split(hsv)
    rust_idx = mask > 0
    if rust_pixels == 0:
        return {
            "rust_pct_total": 0.0,
            "rust_pct_light": 0.0,
            "rust_pct_moderate": 0.0,
            "rust_pct_heavy": 0.0,
            "confidence": 0.6,
            "warnings": [],
        }

    s = S[rust_idx].astype(np.float32)
    v = V[rust_idx].astype(np.float32)

    heavy = (s > 140) & (v < 130)
    moderate = (s > 100) & (v < 170) & ~heavy
    light = ~heavy & ~moderate

    rust_pct_heavy = (heavy.sum() / total_pixels) * 100.0
    rust_pct_moderate = (moderate.sum() / total_pixels) * 100.0
    rust_pct_light = (light.sum() / total_pixels) * 100.0

    warnings: List[str] = []
    confidence = 0.55
    if rust_pct_total > 60:
        warnings.append("very_high_rust_check_false_positive")
        confidence = 0.45

    return {
        "rust_pct_total": float(round(rust_pct_total, 2)),
        "rust_pct_light": float(round(rust_pct_light, 2)),
        "rust_pct_moderate": float(round(rust_pct_moderate, 2)),
        "rust_pct_heavy": float(round(rust_pct_heavy, 2)),
        "confidence": float(round(confidence, 2)),
        "warnings": warnings,
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/healthz")
def health_check():
    return {"status": "ok"}


@app.post("/analyze-photo")
async def analyze_photo(
    photo_id: str = Form(...),
    storage_path: str = Form(...),
    area_type: str = Form(...),
    location_tag: Optional[str] = Form(None),
):
    """
    Production upload flow:
    frontend sends photo_id + storage_path after upload to Supabase.
    Backend downloads original image from storage, runs analyzer,
    uploads marked/masked outputs back to storage, and upserts photo_findings.
    """
    print("=== ANALYZE-PHOTO START ===")
    print("photo_id:", photo_id)
    print("storage_path (incoming):", storage_path)
    print("area_type:", area_type)
    print("location_tag:", location_tag)

    try:
        # Convert full URL → relative path
        if storage_path.startswith("http"):
            marker = f"/storage/v1/object/public/{PHOTOS_BUCKET}/"
            if marker in storage_path:
                storage_path = storage_path.split(marker)[1]

        print("FINAL storage_path used:", storage_path)

        bgr = read_storage_image_as_bgr(storage_path)
        print("Image downloaded from storage successfully. shape:", getattr(bgr, "shape", None))

        cfg = RustConfig(area_type=area_type or "MAIN_DECK")
        result, mask, overlay = analyze_rust_bgr(bgr, cfg)
        print(
            "Analysis completed:",
            {
                "rust_pct_total": float(result.rust_pct_total),
                "severity": str(result.severity),
                "confidence": float(result.confidence),
            },
        )

        base_name = os.path.basename(storage_path)
        stem, _ = os.path.splitext(base_name)
        folder = os.path.dirname(storage_path)

        marked_path = f"{folder}/{stem}_marked.jpg"
        mask_path = f"{folder}/{stem}_mask.jpg"

        print("marked_path:", marked_path)
        print("mask_path:", mask_path)

        if len(mask.shape) == 2:
            mask_vis = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        else:
            mask_vis = mask

        marked_url = upload_to_storage(marked_path, encode_jpg(overlay, 88), "image/jpeg")
        print("marked_url:", marked_url)

        masked_url = upload_to_storage(mask_path, encode_jpg(mask_vis, 88), "image/jpeg")
        print("masked_url:", masked_url)

        upsert_photo_findings(
            photo_id=photo_id,
            storage_path=storage_path,
            marked_path=marked_path,
            mask_path=mask_path,
            result=result,
        )
        print("photo_findings upsert completed")

        print("=== ANALYZE-PHOTO SUCCESS ===")
        return JSONResponse(
            {
                "ok": True,
                "photo_id": photo_id,
                "storage_path": storage_path,
                "area_type": area_type,
                "location_tag": location_tag,
                "rust_pct_total": float(result.rust_pct_total),
                "rust_pct_light": float(result.rust_pct_light),
                "rust_pct_moderate": float(result.rust_pct_moderate),
                "rust_pct_heavy": float(result.rust_pct_heavy),
                "severity": str(result.severity),
                "confidence": float(result.confidence),
                "marked_url": marked_url,
                "masked_url": masked_url,
                "marked_image_path": marked_path,
                "mask_image_path": mask_path,
            }
        )

    except Exception as e:
        print("=== ANALYZE-PHOTO ERROR ===")
        print("error:", repr(e))
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": str(e),
                "photo_id": photo_id,
                "storage_path": storage_path,
                "area_type": area_type,
                "location_tag": location_tag,
            },
        )


@app.post("/extract")
async def extract_images(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()

    extracted: List[Dict[str, Any]] = []

    if filename.endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(content))
        for ws in wb.worksheets:
            for img in getattr(ws, "_images", []):
                try:
                    raw = img._data()
                    im = Image.open(io.BytesIO(raw)).convert("RGB")
                    out = io.BytesIO()
                    im.save(out, format="PNG")
                    extracted.append(
                        {
                            "name": f"{ws.title}_{uuid.uuid4().hex}.png",
                            "bytes": out.getvalue(),
                            "content_type": "image/png",
                        }
                    )
                except Exception:
                    continue

    elif filename.endswith(".docx"):
        doc = Document(io.BytesIO(content))
        rels = doc.part._rels
        for rel in rels.values():
            if "image" in rel.reltype:
                img_bytes = rel.target_part.blob
                try:
                    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                    out = io.BytesIO()
                    im.save(out, format="PNG")
                    extracted.append(
                        {
                            "name": f"doc_{uuid.uuid4().hex}.png",
                            "bytes": out.getvalue(),
                            "content_type": "image/png",
                        }
                    )
                except Exception:
                    continue
    else:
        raise HTTPException(status_code=400, detail="Only .xlsx or .docx supported in /extract")

    return {
        "count": len(extracted),
        "images": [
            {
                "name": x["name"],
                "content_type": x["content_type"],
                "base64": base64.b64encode(x["bytes"]).decode("utf-8"),
            }
            for x in extracted
        ],
    }


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    content = await image.read()
    bgr = read_image_to_bgr(content)
    return analyze_rust_baseline(bgr)


@app.post("/report/vessel")
async def report_vessel(
    vessel_name: str = Form(...),
    area: str = Form(...),
    summary_json: str = Form(...),
    photos_json: str = Form(...),
):
    summary = json.loads(summary_json)
    photos = json.loads(photos_json)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4)
    styles = getSampleStyleSheet()
    story: List[Any] = []

    story.append(Paragraph(f"Rust Condition Report - {vessel_name}", styles["Title"]))
    story.append(Paragraph(f"Area: {area}", styles["Normal"]))
    story.append(Paragraph(f"Generated: {date.today().isoformat()}", styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Summary", styles["Heading2"]))
    for k, v in summary.items():
        story.append(Paragraph(f"{k}: {v}", styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Photo Results", styles["Heading2"]))
    story.append(Spacer(1, 6))

    for idx, p in enumerate(photos, start=1):
        story.append(
            Paragraph(
                f"{idx}. {p.get('location_tag', '(no tag)')} - Rust {p.get('rust_pct_total')}%",
                styles["Normal"],
            )
        )
        url = p.get("image_url")
        if url:
            try:
                r = requests.get(url, timeout=20)
                r.raise_for_status()
                im = Image.open(io.BytesIO(r.content)).convert("RGB")
                out = io.BytesIO()
                im.save(out, format="PNG")
                out.seek(0)
                story.append(RLImage(out, width=400, height=250))
            except Exception:
                story.append(Paragraph("Image unavailable", styles["Italic"]))
        story.append(Spacer(1, 12))
        if idx % 2 == 0:
            story.append(PageBreak())

    doc.build(story)
    pdf_bytes = buf.getvalue()
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")