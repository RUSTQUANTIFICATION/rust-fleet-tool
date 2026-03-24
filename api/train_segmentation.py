# api/train_segmentation.py
from __future__ import annotations

import argparse
from pathlib import Path
from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Train marine rust segmentation model")
    parser.add_argument("--data", required=True, help="Path to dataset YAML")
    parser.add_argument("--model", default="yolo11s-seg.pt", help="Base pretrained seg model")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--imgsz", type=int, default=1024)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", default="0", help="GPU id like 0, or cpu")
    parser.add_argument("--project", default="runs/marine_rust_seg")
    parser.add_argument("--name", default="exp")
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        raise FileNotFoundError(f"Dataset YAML not found: {data_path}")

    model = YOLO(args.model)

    results = model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        patience=args.patience,
        workers=args.workers,
        seed=args.seed,
        pretrained=True,
        optimizer="auto",
        cos_lr=True,
        close_mosaic=10,
        amp=True,
        hsv_h=0.010,
        hsv_s=0.60,
        hsv_v=0.40,
        degrees=5.0,
        translate=0.05,
        scale=0.15,
        shear=2.0,
        fliplr=0.5,
        flipud=0.0,
        copy_paste=0.0,
    )

    print("Training complete.")
    print(results)

    best_path = Path(args.project) / args.name / "weights" / "best.pt"
    if best_path.exists():
        print(f"Best model: {best_path}")
    else:
        print("Best model path not found; check training output directory.")


if __name__ == "__main__":
    main()