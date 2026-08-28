"""ERP import mode: OCR markdown → 知識通 → ERP 匯入檔.

`routes.router` is the only thing main.py needs. Nothing in this package
imports marker/torch, so it stays importable (and testable) on its own.
"""
from .routes import router

__all__ = ["router"]
