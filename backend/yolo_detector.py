"""
YOLO-based Notes region detector for engineering technical drawings.

Loads a trained YOLOv8 model and detects the bounding box of the
'Notes:' section in a rendered page image.

Usage
-----
    detector = YOLONotesDetector()
    detector.load("models/notes_best.pt")

    # image: PIL.Image
    bbox = detector.detect(image)
    # bbox -> (x0, y0, x1, y1) in pixels, or None if not detected
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


class YOLONotesDetector:
    """Wraps a YOLOv8 model to detect the Notes region on a drawing page."""

    # Minimum YOLO confidence to accept a detection.
    MIN_CONFIDENCE: float = 0.25

    def __init__(self) -> None:
        self._model = None
        self._model_path: Path | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, model_path: str | Path) -> None:
        """
        Load a trained YOLOv8 weights file (.pt).

        Parameters
        ----------
        model_path : path to the .pt file produced by `yolo train` or
                     exported from Roboflow.

        Raises
        ------
        FileNotFoundError  : if *model_path* does not exist.
        ImportError        : if `ultralytics` is not installed.
        RuntimeError       : if the model file cannot be loaded.
        """
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ImportError(
                "ultralytics is required for YOLO detection. "
                "Install it with: pip install ultralytics"
            ) from exc

        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"YOLO model not found: {model_path}")

        print(f"[YOLO] Loading model from {model_path} ...")
        self._model = YOLO(str(model_path))
        self._model_path = model_path
        print(f"[YOLO] Model loaded: {model_path.name}")

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def detect(
        self,
        image: Image.Image,
        conf: float = MIN_CONFIDENCE,
    ) -> tuple[int, int, int, int] | None:
        """
        Run inference on a PIL image and return the Notes bbox.

        If multiple detections are found the one with the highest confidence
        is returned.

        Parameters
        ----------
        image : rendered page image (PIL.Image, any size)
        conf  : minimum confidence threshold (default: MIN_CONFIDENCE)

        Returns
        -------
        (x0, y0, x1, y1) in pixels — ints — or None if nothing detected.
        """
        if self._model is None:
            raise RuntimeError(
                "YOLO model is not loaded. Call YOLONotesDetector.load() first."
            )

        results = self._model.predict(
            source=image,
            conf=conf,
            verbose=False,
        )

        best_conf = -1.0
        best_box = None

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                box_conf = float(box.conf[0])
                if box_conf > best_conf:
                    best_conf = box_conf
                    xyxy = box.xyxy[0].tolist()
                    best_box = (
                        int(xyxy[0]),
                        int(xyxy[1]),
                        int(xyxy[2]),
                        int(xyxy[3]),
                    )

        if best_box is not None:
            print(
                f"[YOLO] Detected Notes region: {best_box}  conf={best_conf:.3f}"
            )
        else:
            print(f"[YOLO] No Notes region detected (conf threshold={conf})")

        return best_box

    def detect_as_fractions(
        self,
        image: Image.Image,
        conf: float = MIN_CONFIDENCE,
    ) -> tuple[float, float, float, float] | None:
        """
        Like :meth:`detect` but returns coordinates as fractions of the
        image dimensions (0–1), matching the template-coordinate convention
        used in ``notes_extractor.py``.

        Returns
        -------
        (x_min, y_min, x_max, y_max) as floats in [0, 1], or None.
        """
        bbox = self.detect(image, conf=conf)
        if bbox is None:
            return None

        w, h = image.size
        x0, y0, x1, y1 = bbox
        return (x0 / w, y0 / h, x1 / w, y1 / h)
