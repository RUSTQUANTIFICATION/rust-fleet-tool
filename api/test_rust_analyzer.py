import cv2
from rust_analyzer import analyze_rust_bgr, RustConfig

IMAGE_PATH = "test.jpg"

img = cv2.imread(IMAGE_PATH)
if img is None:
    raise RuntimeError(f"Could not load image: {IMAGE_PATH}")

result, mask, overlay = analyze_rust_bgr(
    img,
    RustConfig(
        area_type="MAIN_DECK",
        analyzer_mode="heuristic",
    ),
)

print("Rust total:", result.rust_pct_total)
print("Rust light:", result.rust_pct_light)
print("Rust moderate:", result.rust_pct_moderate)
print("Rust heavy:", result.rust_pct_heavy)
print("Severity:", result.severity)
print("Confidence:", result.confidence)

cv2.imwrite("test_mask.png", mask)
cv2.imwrite("test_overlay.png", overlay)

print("Saved test_mask.png")
print("Saved test_overlay.png")