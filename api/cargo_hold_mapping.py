from __future__ import annotations

import re
from typing import Optional, Dict, Any


CARGO_HOLD_POINT_MAP = {
    "fwd_bulkhead": {"point_no": 1, "zone_name": "FWD BULKHEAD"},
    "port_bulkhead": {"point_no": 2, "zone_name": "PORT BULKHEAD"},
    "floor": {"point_no": 3, "zone_name": "FLOOR"},
    "stbd_bulkhead": {"point_no": 4, "zone_name": "STBD BULKHEAD"},
    "aft_bulkhead": {"point_no": 5, "zone_name": "AFT BULKHEAD"},
    "underside_hatch_cover": {"point_no": 6, "zone_name": "UNDERSIDE OF HATCH COVER"},
    "fwd_hatch_cover": {"point_no": 7, "zone_name": "FWD AREA OF HATCH COVER"},
    "portside_hatch_cover": {"point_no": 8, "zone_name": "PORT SIDE OF HATCH COVER"},
    "topside_hatch_cover": {"point_no": 9, "zone_name": "TOP SIDE OF HATCH COVER"},
    "stbdside_hatch_cover": {"point_no": 10, "zone_name": "STBD SIDE OF HATCH COVER"},
    "aft_hatch_cover": {"point_no": 11, "zone_name": "AFT PART OF HATCH COVER"},
}


def normalize_location_tag(location_tag: str | None) -> str:
    if not location_tag:
        return ""

    tag = str(location_tag).strip().lower()
    tag = tag.replace("-", "_").replace(" ", "_")
    tag = re.sub(r"_+", "_", tag)
    return tag


def extract_hold_no(location_tag: str | None, default_hold_no: int = 1) -> int:
    tag = normalize_location_tag(location_tag)
    m = re.match(r"hold(\d+)_", tag)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return default_hold_no
    return default_hold_no


def strip_hold_prefix(location_tag: str | None) -> str:
    tag = normalize_location_tag(location_tag)
    return re.sub(r"^hold\d+_", "", tag)


def map_cargo_hold_tag(location_tag: str | None, default_hold_no: int = 1) -> Optional[Dict[str, Any]]:
    """
    Example:
      hold1_fwd_bulkhead -> {hold_no:1, point_no:1, zone_name:'FWD BULKHEAD'}
      hold2_floor        -> {hold_no:2, point_no:3, zone_name:'FLOOR'}
    """
    if not location_tag:
        return None

    hold_no = extract_hold_no(location_tag, default_hold_no)
    bare = strip_hold_prefix(location_tag)

    mapped = CARGO_HOLD_POINT_MAP.get(bare)
    if not mapped:
        return None

    return {
        "hold_no": hold_no,
        "point_no": mapped["point_no"],
        "zone_name": mapped["zone_name"],
        "normalized_tag": bare,
    }


if __name__ == "__main__":
    tests = [
        "hold1_fwd_bulkhead",
        "hold2_floor",
        "hold3_topside_hatch_cover",
        "hold5_stbdside_hatch_cover",
        "hold4_aft_hatch_cover",
    ]

    for t in tests:
        print(t, "->", map_cargo_hold_tag(t))