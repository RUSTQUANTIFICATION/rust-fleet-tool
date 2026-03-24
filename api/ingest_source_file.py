# api/ingest_source_file.py
from __future__ import annotations

import os
from pathlib import Path
from typing import List

from extract_images_excel import extract_images_excel
from extract_images_word import extract_images_word
from extract_images_pdf import extract_images_pdf


def ingest_source_file(file_path: str, output_dir: str, source_type: str) -> List[str]:
    os.makedirs(output_dir, exist_ok=True)

    source_type = (source_type or "").strip().upper()
    ext = Path(file_path).suffix.lower()

    if source_type == "EXCEL" or ext in [".xlsx", ".xlsm"]:
        return extract_images_excel(file_path, output_dir)

    if source_type == "WORD" or ext == ".docx":
        return extract_images_word(file_path, output_dir)

    if source_type == "PDF" or ext == ".pdf":
        return extract_images_pdf(file_path, output_dir)

    if source_type == "IMAGE_BATCH" or ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]:
        out_path = os.path.join(output_dir, Path(file_path).name)
        if os.path.abspath(file_path) != os.path.abspath(out_path):
            with open(file_path, "rb") as src, open(out_path, "wb") as dst:
                dst.write(src.read())
        return [out_path]

    raise ValueError(f"Unsupported file/source type: {source_type or ext}")