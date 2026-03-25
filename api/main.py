# api/main.py
# Paste-ready, single-file FastAPI backend for Rust Fleet Tool
# - Health check
# - Analyze single photo (enterprise rust analyzer via rust_analyzer.py)
# - Analyze baseline (simple HSV) for comparison
# - Extract embedded images from Excel/Word
# - Generate vessel PDF report (downloads images via URL)

from __future__ import annotations

import base64
import io
import os
import uuid
from datetime import date
from typing import Any, Dict, List

import cv2
import numpy as np
import openpyxl
import pandas as pd
import requests
from dotenv import load_dotenv
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
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

# Load environment variables from api/.env
load_dotenv()

# Import the enterprise analyzer you created in api/rust_analyzer.py
from rust_analyzer import analyze_rust_bgr  # noqa: E402


# -----------------------------
# App
# -----------------------------
app = FastAPI(title="Rust Fleet Analysis API")


# -----------------------------
# Env / Supabase helpers
# -----------------------------
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


def upload_to_storage(path: str, content: bytes, content_type: str) -> None:
    sb = supabase()
    sb.storage.from_(PHOTOS_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def upload_report(path: str, content: bytes, content_type: str) -> None:
    sb = supabase()
    sb.storage.from_(REPORTS_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )


# -----------------------------
# Image helpers
# -----------------------------
def read_image_to_bgr(file_bytes: bytes) -> np.ndarray:
    npbuf = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(npbuf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Unsupported image format")
    return img


# -----------------------------
# Baseline rust analysis (simple)
# -----------------------------
def analyze_rust_baseline(bgr: np.ndarray) -> Dict[str, Any]:
    """
    Baseline: rust detection using HSV threshold + morphology.
    Returns rust % and severity buckets (simple proxy using saturation/value).
    """
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

    H, S, V = cv2.split(hsv)
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


# -----------------------------
# Endpoints
# -----------------------------
@app.get("/health")
def health():
    return {"ok": True}


@app.get("/healthz")
def health_check():
    return {"status": "ok"}


@app.post("/analyze-photo")
async def analyze_photo(file: UploadFile = File(...)):
    """
    Enterprise analyzer:
    - Upload a single image
    - Returns rust percentages + severity + confidence + debug
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        return JSONResponse(status_code=400, content={"error": "Please upload an image file."})

    data = await file.read()

    try:
        bgr = read_image_to_bgr(data)
    except Exception:
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        rgb = np.array(pil)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    result, mask, overlay = analyze_rust_bgr(bgr)

    return {
        "filename": file.filename,
        "rust_pct_total": result.rust_pct_total,
        "rust_pct_light": result.rust_pct_light,
        "rust_pct_moderate": result.rust_pct_moderate,
        "rust_pct_heavy": result.rust_pct_heavy,
        "severity": result.severity,
        "confidence": result.confidence,
        "debug": result.debug,
    }


@app.post("/extract")
async def extract_images(file: UploadFile = File(...)):
    """
    Upload an Excel/Word file and return extracted images as base64 PNG + names.
    """
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
    """
    Baseline analyzer endpoint (for comparison / fallback).
    """
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
    """
    Generate a vessel PDF report.
    photos_json expects items like:
      { "location_tag": "Hold 1", "rust_pct_total": 5.2, "image_url": "https://..." }
    """
    import json

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
                f"{idx}. {p.get('location_tag','(no tag)')} - Rust {p.get('rust_pct_total')}%",
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