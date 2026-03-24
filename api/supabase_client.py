from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Dict, Any

from dotenv import load_dotenv
from supabase import create_client, Client

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
PHOTOS_BUCKET = os.getenv("PHOTOS_BUCKET", "rust-photos").strip()

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in api/.env")

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_photos_bucket() -> str:
    return PHOTOS_BUCKET


def upload_file_to_storage(
    local_path: str,
    storage_path: str,
    content_type: str = "image/jpeg",
) -> str:
    with open(local_path, "rb") as f:
        data = f.read()

    sb.storage.from_(PHOTOS_BUCKET).upload(
        path=storage_path,
        file=data,
        file_options={
            "content-type": content_type,
            "upsert": "true",
        },
    )
    return storage_path


def create_inspection_session(
    vessel_id: str,
    area_type: str,
    area_name: str,
    source_file: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    payload = {
        "vessel_id": vessel_id,
        "area_type": area_type,
        "area_name": area_name,
        "source_file": source_file,
        "created_by": created_by,
    }

    res = sb.table("inspection_sessions").insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError("Failed to create inspection session")
    return rows[0]


def insert_inspection_photo(
    session_id: str,
    vessel_id: str,
    area_type: str,
    location_tag: Optional[str],
    image_path: str,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    payload = {
        "session_id": session_id,
        "vessel_id": vessel_id,
        "area_type": area_type,
        "location_tag": location_tag,
        "image_path": image_path,
        "created_by": created_by,
    }

    res = sb.table("inspection_photos").insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError("Failed to insert inspection photo")
    return rows[0]

def insert_photo_finding(
    photo_id: str,
    rust_pct: float = 0.0,
    largest_patch: float = 0.0,
    cluster_count: int = 0,
    analysis_status: str = "COMPLETED",
) -> Dict[str, Any]:
    payload = {
        "photo_id": photo_id,
        "rust_pct": rust_pct,
        "rust_pct_total": rust_pct,
        "largest_patch": largest_patch,
        "cluster_count": cluster_count,
        "analysis_status": analysis_status,
    }

    res = sb.table("photo_findings").insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError("Failed to insert photo finding")
    return rows[0]
    payload = {
        "photo_id": photo_id,
        "rust_pct": rust_pct,
        "rust_pct_total": rust_pct,
        "largest_patch": largest_patch,
        "cluster_count": cluster_count,
        "analysis_status": "NOT_STARTED",
    }

    res = sb.table("photo_findings").insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError("Failed to insert photo finding")
    return rows[0]