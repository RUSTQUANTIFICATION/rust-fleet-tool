# api/train_texture_classifier.py
from __future__ import annotations

import argparse
from pathlib import Path
from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Train rust texture classifier")
    parser.add_argument("--data", required=True, help="Root folder of classification dataset")
    parser.add_argument("--model", default="yolo11s-cls.pt", help="Base pretrained cls model")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--imgsz", type=int, default=224)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--device", default="0", help="GPU id like 0, or cpu")
    parser.add_argument("--project", default="runs/rust_texture_cls")
    parser.add_argument("--name", default="exp")
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        raise FileNotFoundError(f"Classification dataset folder not found: {data_path}")

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
        amp=True,
        hsv_h=0.005,
        hsv_s=0.25,
        hsv_v=0.25,
        degrees=3.0,
        translate=0.02,
        scale=0.10,
        fliplr=0.5,
        flipud=0.0,
    )

    print("Training complete.")
    print(results)

    best_path = Path(args.project) / args.name / "weights" / "best.pt"
    if best_path.exists():
        print(f"Best classifier: {best_path}")
    else:
        print("Best classifier path not found; check training output directory.")


if __name__ == "__main__":
    main()