from __future__ import annotations

import io
import mimetypes
import os
import shutil
import tempfile
import uuid
import traceback
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import unquote

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from ingest_source_file import ingest_source_file
from run_extracted_analysis import run_batch_rust_analysis
from build_report import build_inspection_report_pdf
from rust_analyzer import analyze_rust_bgr, RustConfig
from supabase_client import (
    sb,
    upload_file_to_storage,
    create_inspection_session,
    insert_inspection_photo,
    insert_photo_finding,
)

app = FastAPI(title="Rust Fleet Tool API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
TEMP_ROOT = BASE_DIR / "temp_uploads"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)

PHOTOS_BUCKET = "rust-photos"
REPORTS_BUCKET = "rust-reports"

VALID_AREAS = {
    "CARGO_HOLD",
    "MAIN_DECK",
    "VOID_SPACE",
    "BALLAST_TANK",
    "CARGO_TANK",
}


def detect_source_type(filename: str, declared: Optional[str]) -> str:
    if declared:
        return declared.strip().upper()

    ext = Path(filename).suffix.lower()

    if ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]:
        return "IMAGE_BATCH"
    if ext in [".xlsx", ".xlsm"]:
        return "EXCEL"
    if ext == ".docx":
        return "WORD"
    if ext == ".pdf":
        return "PDF"

    raise ValueError(f"Unsupported file type: {ext}")


def detect_area_name(area_type: str, hold_no: Optional[str], space_no: Optional[str]) -> str:
    area_type = (area_type or "").strip().upper()

    if area_type == "CARGO_HOLD":
        return f"Hold {hold_no or '1'}"
    if area_type == "MAIN_DECK":
        return "Main Deck"
    if area_type == "VOID_SPACE":
        return f"Void Space {space_no or '1'}"
    if area_type == "BALLAST_TANK":
        return f"Ballast Tank {space_no or '1'}"
    if area_type == "CARGO_TANK":
        return f"Cargo Tank {space_no or '1'}"

    return "Inspection Area"


def guess_content_type(path: str) -> str:
    ctype, _ = mimetypes.guess_type(path)
    return ctype or "application/octet-stream"


def safe_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0
def safe_int(v: Any) -> int:
    try:
        if v is None:
            return 0
        return int(v)
    except Exception:
        return 0

def signed_storage_url(bucket: str, path: Optional[str], expires_in: int = 3600) -> Optional[str]:
    if not path:
        return None

    try:
        res = sb.storage.from_(bucket).create_signed_url(path, expires_in)
        if isinstance(res, dict):
            return res.get("signedURL") or res.get("signedUrl")
        if hasattr(res, "get"):
            return res.get("signedURL") or res.get("signedUrl")
    except Exception:
        return None

    return None


def _download_storage_file(bucket: str, storage_path: str, local_path: str) -> None:
    try:
        file_bytes = sb.storage.from_(bucket).download(storage_path)
    except Exception as e:
        raise RuntimeError(f"Storage download failed for {storage_path}: {e}")

    if file_bytes is None:
        raise RuntimeError(f"No file returned from storage for {storage_path}")

    with open(local_path, "wb") as f:
        f.write(file_bytes)


def _severity_bands(total_pct: float) -> tuple[float, float, float]:
    light = round(total_pct * 0.50, 4)
    moderate = round(total_pct * 0.30, 4)
    heavy = round(total_pct * 0.20, 4)
    return light, moderate, heavy


def _derive_storage_paths(storage_path: str, photo_id: str) -> Dict[str, str]:
    storage_path = storage_path.strip().lstrip("/")
    path_obj = Path(storage_path)

    ext = path_obj.suffix.lower() or ".jpg"
    parent_parts = list(path_obj.parent.parts)

    if parent_parts and parent_parts[0] == "original":
        relative_parts = parent_parts[1:]
    else:
        relative_parts = parent_parts

    relative_dir = "/".join(relative_parts)
    if relative_dir:
        original_path = f"original/{relative_dir}/{photo_id}_original{ext}"
        marked_path = f"marked/{relative_dir}/{photo_id}_marked.png"
        mask_path = f"mask/{relative_dir}/{photo_id}_mask.png"
    else:
        original_path = f"original/{photo_id}_original{ext}"
        marked_path = f"marked/{photo_id}_marked.png"
        mask_path = f"mask/{photo_id}_mask.png"

    return {
        "original_image_path": original_path,
        "marked_image_path": marked_path,
        "mask_image_path": mask_path,
    }


def _estimate_image_quality_score(bgr: np.ndarray) -> float:
    if bgr is None or bgr.size == 0:
        return 0.0

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    mean_brightness = float(np.mean(gray))

    blur_norm = min(max(blur_score / 400.0, 0.0), 1.0)

    if mean_brightness < 40:
        bright_norm = 0.25
    elif mean_brightness < 70:
        bright_norm = 0.55
    elif mean_brightness <= 190:
        bright_norm = 1.0
    elif mean_brightness <= 225:
        bright_norm = 0.75
    else:
        bright_norm = 0.45

    score = (blur_norm * 0.65 + bright_norm * 0.35) * 100.0
    return round(float(min(max(score, 0.0), 100.0)), 2)


def _mask_metrics(mask: np.ndarray) -> Tuple[float, int]:
    if mask is None or getattr(mask, "size", 0) == 0:
        return 0.0, 0

    try:
        if len(mask.shape) == 3:
            gray_mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
        else:
            gray_mask = mask

        binary = (gray_mask > 0).astype(np.uint8) * 255

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

        if num_labels <= 1 or stats is None:
            return 0.0, 0

        component_areas: List[int] = []

        for i in range(1, int(num_labels)):
            raw_area = stats[i, cv2.CC_STAT_AREA]
            if raw_area is None:
                continue

            try:
                area = int(raw_area)
            except Exception:
                area = 0

            if area > 0:
                component_areas.append(area)

        if not component_areas:
            return 0.0, 0

        total_px = float(binary.shape[0] * binary.shape[1])
        if total_px <= 0:
            return 0.0, 0

        largest_patch_pct = (max(component_areas) / total_px) * 100.0
        cluster_count = len(component_areas)

        return round(float(largest_patch_pct), 4), int(cluster_count)

    except Exception:
        return 0.0, 0


def _normalize_severity(rust_pct: float) -> str:
    if rust_pct <= 2:
        return "LOW"
    if rust_pct <= 5:
        return "WATCH"
    if rust_pct <= 12:
        return "MODERATE"
    return "HIGH"


def _build_warning_list(
    rust_pct: float,
    confidence_score: float,
    image_quality_score: float,
    false_positive_risk: float,
    cluster_count: int,
) -> List[str]:
    warnings: List[str] = []

    if image_quality_score < 45:
        warnings.append("poor image quality")
    elif image_quality_score < 65:
        warnings.append("image quality moderate")

    if confidence_score < 45:
        warnings.append("low confidence detection")
    elif confidence_score < 65:
        warnings.append("medium confidence detection")

    if false_positive_risk >= 60:
        warnings.append("high false positive risk")
    elif false_positive_risk >= 35:
        warnings.append("possible false positive regions")

    if rust_pct == 0:
        warnings.append("no rust detected")

    if cluster_count > 25:
        warnings.append("many rust clusters detected")

    return warnings


def _encode_png(path: str, image: np.ndarray) -> None:
    ok = cv2.imwrite(path, image)
    if not ok:
        raise RuntimeError(f"Failed to write image: {path}")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze-photo")
async def analyze_photo_endpoint(
    photo_id: str = Form(...),
    storage_path: str = Form(...),
    area_type: str = Form(...),
    location_tag: Optional[str] = Form(None),
) -> Dict[str, Any]:
    area_type = (area_type or "").strip().upper()

    if area_type not in VALID_AREAS:
        raise HTTPException(status_code=400, detail=f"Invalid area_type: {area_type}")

    temp_dir = tempfile.mkdtemp(prefix="rust_analyze_", dir=str(TEMP_ROOT))
    try:
        ext = Path(storage_path).suffix or ".jpg"
        local_img = os.path.join(temp_dir, f"input{ext}")
        local_overlay = os.path.join(temp_dir, "overlay.png")
        local_mask = os.path.join(temp_dir, "mask.png")

        (
            sb.table("photo_findings")
            .update({"analysis_status": "PROCESSING"})
            .eq("photo_id", photo_id)
            .execute()
        )

        _download_storage_file(PHOTOS_BUCKET, storage_path, local_img)

        bgr = cv2.imread(local_img)
        if bgr is None:
            raise HTTPException(status_code=400, detail="Downloaded image could not be read")

        cfg = RustConfig()
        cfg.area_type = area_type

        try:
            result, mask, overlay = analyze_rust_bgr(bgr, cfg)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Rust analyzer failed: {str(e)}")

        rust_pct = safe_float(getattr(result, "rust_pct_total", None))
        if rust_pct == 0:
            rust_pct = safe_float(getattr(result, "rust_pct", None))
        if rust_pct == 0:
            rust_pct = safe_float(getattr(result, "rust_percentage", None))

        if rust_pct == 0 and isinstance(result, dict):
            rust_pct = safe_float(
                result.get("rust_pct_total")
                or result.get("rust_pct")
                or result.get("rust_percentage")
            )

        light = safe_float(getattr(result, "rust_pct_light", None))
        moderate = safe_float(getattr(result, "rust_pct_moderate", None))
        heavy = safe_float(getattr(result, "rust_pct_heavy", None))

        if light == 0 and moderate == 0 and heavy == 0:
            light, moderate, heavy = _severity_bands(rust_pct)

        severity = getattr(result, "severity", None)
        if not severity and isinstance(result, dict):
            severity = result.get("severity")

        analyzer_confidence = safe_float(getattr(result, "confidence", None))
        if analyzer_confidence <= 1.0:
            confidence_score = round(analyzer_confidence * 100.0, 2)
        else:
            confidence_score = round(analyzer_confidence, 2)

        image_quality_score = _estimate_image_quality_score(bgr)
        largest_patch, cluster_count = _mask_metrics(mask)
        largest_patch = safe_float(largest_patch)
        cluster_count = safe_int(cluster_count)

        false_positive_risk = round(
            max(
                0.0,
                min(
                    100.0,
                    100.0 - confidence_score + max(0.0, 60.0 - image_quality_score) * 0.35,
                ),
            ),
            2,
        )

        manual_review_required = (
            confidence_score < 55
            or image_quality_score < 50
            or false_positive_risk >= 50
        )

        normalized_severity = str(severity).upper() if severity else _normalize_severity(rust_pct)
        warnings = _build_warning_list(
            rust_pct=rust_pct,
            confidence_score=confidence_score,
            image_quality_score=image_quality_score,
            false_positive_risk=false_positive_risk,
            cluster_count=cluster_count,
        )

        if mask is not None:
            if len(mask.shape) == 2:
                _encode_png(local_mask, mask)
            else:
                _encode_png(local_mask, cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY))

        if overlay is not None:
            _encode_png(local_overlay, overlay)

        derived_paths = _derive_storage_paths(storage_path, photo_id)

        original_image_path = storage_path
        marked_image_path = None
        mask_image_path = None

        if os.path.exists(local_overlay):
            marked_image_path = upload_file_to_storage(
                local_path=local_overlay,
                storage_path=derived_paths["marked_image_path"],
                content_type="image/png",
            )

        if os.path.exists(local_mask):
            mask_image_path = upload_file_to_storage(
                local_path=local_mask,
                storage_path=derived_paths["mask_image_path"],
                content_type="image/png",
            )

        payload = {
            "rust_pct": round(rust_pct, 4),
            "rust_pct_total": round(rust_pct, 4),
            "rust_pct_light": round(light, 4),
            "rust_pct_moderate": round(moderate, 4),
            "rust_pct_heavy": round(heavy, 4),
            "largest_patch": safe_float(largest_patch),
            "cluster_count": safe_int(cluster_count),
            "overall_severity": normalized_severity,
            "original_image_path": original_image_path,
            "marked_image_path": marked_image_path,
            "mask_image_path": mask_image_path,
            "analysis_status": "COMPLETED",
            "confidence_score": safe_float(confidence_score),
            "image_quality_score": safe_float(image_quality_score),
            "false_positive_risk": safe_float(false_positive_risk),
            "manual_review_required": manual_review_required,
            "raw_warnings": warnings,
            "warnings": ", ".join(warnings) if warnings else None,
        }

        update_res = (
            sb.table("photo_findings")
            .update(payload)
            .eq("photo_id", photo_id)
            .execute()
        )

        updated_rows = update_res.data or []

        return {
            "ok": True,
            "photo_id": photo_id,
            "storage_path": storage_path,
            "area_type": area_type,
            "location_tag": location_tag,
            "rust_pct": round(rust_pct, 4),
            "rust_pct_total": round(rust_pct, 4),
            "rust_pct_light": round(light, 4),
            "rust_pct_moderate": round(moderate, 4),
            "rust_pct_heavy": round(heavy, 4),
            "largest_patch": largest_patch,
            "cluster_count": cluster_count,
            "overall_severity": normalized_severity,
            "confidence_score": confidence_score,
            "image_quality_score": image_quality_score,
            "false_positive_risk": false_positive_risk,
            "manual_review_required": manual_review_required,
            "warnings": warnings,
            "original_image_path": original_image_path,
            "marked_image_path": marked_image_path,
            "mask_image_path": mask_image_path,
            "original_image_signed_url": signed_storage_url(PHOTOS_BUCKET, original_image_path),
            "marked_image_signed_url": signed_storage_url(PHOTOS_BUCKET, marked_image_path),
            "mask_image_signed_url": signed_storage_url(PHOTOS_BUCKET, mask_image_path),
            "updated_row": updated_rows[0] if updated_rows else None,
        }

    except HTTPException:
        try:
            (
                sb.table("photo_findings")
                .update({"analysis_status": "FAILED", "warnings": "analysis failed"})
                .eq("photo_id", photo_id)
                .execute()
            )
        except Exception:
            pass
        raise
    except Exception as e:
        traceback.print_exc()
        try:
            (
                sb.table("photo_findings")
                .update({"analysis_status": "FAILED", "warnings": str(e)})
                .eq("photo_id", photo_id)
                .execute()
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Photo analysis failed: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/ingest-source-file")
async def ingest_source_file_endpoint(
    file: UploadFile = File(...),
    vessel_id: str = Form(...),
    area_type: str = Form(...),
    hold_no: Optional[str] = Form(None),
    space_no: Optional[str] = Form(None),
    source_type: Optional[str] = Form(None),
    created_by: str = Form(...),
) -> Dict[str, Any]:
    area_type = (area_type or "").strip().upper()

    if area_type not in VALID_AREAS:
        raise HTTPException(status_code=400, detail=f"Invalid area_type: {area_type}")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file name received")

    try:
        resolved_source_type = detect_source_type(file.filename, source_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job_id = str(uuid.uuid4())
    job_dir = TEMP_ROOT / job_id
    input_dir = job_dir / "input"
    extract_dir = job_dir / "extracted"
    preview_dir = job_dir / "previews"

    input_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    source_path = input_dir / file.filename

    try:
        with open(source_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        extracted_image_paths = ingest_source_file(
            file_path=str(source_path),
            output_dir=str(extract_dir),
            source_type=resolved_source_type,
        )

        if not extracted_image_paths:
            raise HTTPException(status_code=400, detail="No images could be extracted from source file")

        summary = run_batch_rust_analysis(
            extracted_dir=str(extract_dir),
            area_type=area_type,
            output_dir=str(preview_dir),
        )

        area_name = detect_area_name(area_type, hold_no, space_no)
        
        session = create_inspection_session(
            vessel_id=vessel_id,
            area_type=area_type,
            area_name=area_name,
            source_file=file.filename,
            created_by=created_by,
        )

        saved_results: List[Dict[str, Any]] = []

        for item in summary.get("results", []):
            local_image_path = item["image_path"]
            image_name = Path(local_image_path).name
            storage_path = f"{vessel_id}/{session['id']}/{image_name}"

            uploaded_image_path = upload_file_to_storage(
                local_path=local_image_path,
                storage_path=storage_path,
                content_type=guess_content_type(local_image_path),
            )

            derived_location_tag = (
                item.get("location_tag")
                or item.get("tag")
                or item.get("image_name")
                or Path(image_name).stem
            )

            photo = insert_inspection_photo(
                session_id=session["id"],
                vessel_id=vessel_id,
                area_type=area_type,
                location_tag=str(derived_location_tag),
                image_path=uploaded_image_path,
                created_by=created_by,
            )

            # create initial finding (optional)
            finding = insert_photo_finding(
                photo_id=photo["id"],
                rust_pct=float(item.get("rust_pct") or 0),
                largest_patch=0.0,
                cluster_count=0,
                analysis_status="PROCESSING",
            )

            # ✅ CALL ANALYSIS (THIS IS THE KEY FIX)
            await analyze_photo_endpoint(
                photo_id=photo["id"],
                storage_path=uploaded_image_path,
                area_type=area_type,
                location_tag=image_name,
            )

            saved_results.append(
                {
                    **item,
                    "session_id": session["id"],
                    "photo_id": photo["id"],
                    "finding_id": finding["id"],
                    "storage_path": uploaded_image_path,
                    "image_signed_url": signed_storage_url(PHOTOS_BUCKET, uploaded_image_path),
                }
            )

        return {
            "ok": True,
            "job_id": job_id,
            "vessel_id": vessel_id,
            "session_id": session["id"],
            "area_type": area_type,
            "area_name": area_name,
            "source_type": resolved_source_type,
            "source_file_name": file.filename,
            "extracted_image_count": len(extracted_image_paths),
            "image_count": len(saved_results),
            "avg_rust_pct": summary.get("avg_rust_pct", 0),
            "max_rust_pct": summary.get("max_rust_pct", 0),
            "results": saved_results,
            "failed": summary.get("failed", []),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass


@app.post("/generate-report")
async def generate_report_endpoint(
    vessel_name: str = Form(...),
    area_type: str = Form(...),
    created_by: str = Form(...),
) -> Dict[str, Any]:
    
    area_type = (area_type or "").strip().upper()

    if area_type not in VALID_AREAS:
        raise HTTPException(status_code=400, detail=f"Invalid area_type: {area_type}")

    try:
        vessels_res = (
            sb.table("vessels")
            .select("id,name")
            .eq("name", vessel_name)
            .limit(1)
            .execute()
        )
        vessel_rows = vessels_res.data or []

        if not vessel_rows:
            raise HTTPException(status_code=404, detail="Vessel not found")

        vessel_id = vessel_rows[0]["id"]

        reviews_res = (
            sb.table("inspection_reviews")
            .select("photo_id,review_status,reviewer_name,review_notes,reviewed_at")
            .eq("review_status", "APPROVED")
            .execute()
        )
        approved_reviews = reviews_res.data or []
        approved_photo_ids = [r["photo_id"] for r in approved_reviews]

        if not approved_photo_ids:
            raise HTTPException(status_code=400, detail="No approved photos found")

        photos_res = (
            sb.table("inspection_photos")
            .select("id,session_id,vessel_id,area_type,location_tag,image_path,created_at")
            .in_("id", approved_photo_ids)
            .eq("area_type", area_type)
            .eq("vessel_id", vessel_id)
            .order("created_at", desc=False)
            .execute()
        )
        photos = photos_res.data or []

        if not photos:
            raise HTTPException(status_code=400, detail="No approved photos for this vessel/area")

        findings_res = (
            sb.table("photo_findings")
            .select("*")
            .in_("photo_id", [p["id"] for p in photos])
            .execute()
        )
        findings = findings_res.data or []

        finding_map = {f["photo_id"]: f for f in findings}
        review_map = {r["photo_id"]: r for r in approved_reviews}

        report_rows: List[Dict[str, Any]] = []

        for p in photos:
            f = finding_map.get(p["id"], {})
            r = review_map.get(p["id"], {})

            report_rows.append(
                {
                    "photo_id": p["id"],
                    "session_id": p.get("session_id"),
                    "location_tag": p.get("location_tag"),
                    "image_path": p.get("image_path"),
                    "image_signed_url": signed_storage_url(PHOTOS_BUCKET, p.get("image_path")),
                    "original_image_path": f.get("original_image_path") or p.get("image_path"),
                    "marked_image_path": f.get("marked_image_path"),
                    "mask_image_path": f.get("mask_image_path"),
                    "original_image_signed_url": signed_storage_url(
                        PHOTOS_BUCKET,
                        f.get("original_image_path") or p.get("image_path"),
                    ),
                    "marked_image_signed_url": signed_storage_url(
                        PHOTOS_BUCKET,
                        f.get("marked_image_path"),
                    ),
                    "mask_image_signed_url": signed_storage_url(
                        PHOTOS_BUCKET,
                        f.get("mask_image_path"),
                    ),
                    "local_image_path": None,
                    "rust_pct": safe_float(f.get("rust_pct") or f.get("rust_pct_total") or 0),
                    "overall_severity": f.get("overall_severity") or f.get("severity"),
                    "reviewer_name": r.get("reviewer_name"),
                    "review_notes": r.get("review_notes"),
                    "reviewed_at": r.get("reviewed_at"),
                }
            )

        filename = f"{vessel_name}_{area_type}_{uuid.uuid4().hex[:8]}.pdf".replace(" ", "_")
        pdf_path = build_inspection_report_pdf(
            vessel_name=vessel_name,
            area_type=area_type,
            approved_rows=report_rows,
            output_filename=filename,
        )

        report_storage_path = f"reports/{filename}"

        with open(pdf_path, "rb") as f:
            sb.storage.from_(REPORTS_BUCKET).upload(
                report_storage_path,
                f.read(),
                {"content-type": "application/pdf", "upsert": "true"},
            )

        report_insert = (
            sb.table("reports")
            .insert(
                {
                    "vessel_id": vessel_id,
                    "area_type": area_type,
                    "session_id": None,
                    "report_type": "vessel_pdf",
                    "file_path": report_storage_path,
                    "report_path": report_storage_path,
                    "created_by": created_by,
                }
            )
            .execute()
        )

        report_row = (report_insert.data or [None])[0]
        report_signed_url = signed_storage_url(REPORTS_BUCKET, report_storage_path)

        return {
            "ok": True,
            "vessel_id": vessel_id,
            "vessel_name": vessel_name,
            "area_type": area_type,
            "approved_count": len(report_rows),
            "report_path": report_storage_path,
            "report_signed_url": report_signed_url,
            "report_row": report_row,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


@app.get("/approved-photos")
def approved_photos(
    vessel_name: Optional[str] = None,
    area_type: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        vessel_id = None

        if vessel_name:
            vessels_res = (
                sb.table("vessels")
                .select("id,name")
                .eq("name", vessel_name)
                .limit(1)
                .execute()
            )
            vessel_rows = vessels_res.data or []
            if not vessel_rows:
                raise HTTPException(status_code=404, detail="Vessel not found")
            vessel_id = vessel_rows[0]["id"]

        reviews_res = (
            sb.table("inspection_reviews")
            .select("photo_id,review_status,reviewer_name,review_notes,reviewed_at")
            .eq("review_status", "APPROVED")
            .execute()
        )
        approved_reviews = reviews_res.data or []
        approved_photo_ids = [r["photo_id"] for r in approved_reviews]

        if not approved_photo_ids:
            return {"ok": True, "count": 0, "rows": []}

        q = (
            sb.table("inspection_photos")
            .select("id,session_id,vessel_id,area_type,location_tag,image_path,created_at")
            .in_("id", approved_photo_ids)
            .order("created_at", desc=False)
        )

        if vessel_id:
            q = q.eq("vessel_id", vessel_id)
        if area_type:
            q = q.eq("area_type", area_type.strip().upper())

        photos = q.execute().data or []

        return {"ok": True, "count": len(photos), "rows": photos}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/open-report")
def open_report(path: str):
    try:
        report_path = unquote(path).strip().lstrip("/")

        if not report_path:
            raise HTTPException(status_code=400, detail="Missing report path")

        file_bytes = sb.storage.from_(REPORTS_BUCKET).download(report_path)

        if not file_bytes:
            raise HTTPException(status_code=404, detail="Report not found in storage")

        filename = Path(report_path).name

        return StreamingResponse(
            io.BytesIO(file_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{filename}"'
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Open report failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)