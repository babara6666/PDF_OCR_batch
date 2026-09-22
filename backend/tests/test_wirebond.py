"""Tests for the 打線圖 proxy (`/api/wirebond/*`).

The router is mounted on a bare FastAPI app, never main.py, so this imports
neither marker nor torch. The offline tests pin the contract the frontend
relies on: a disabled deployment answers `enabled: false` (not an error), bad
job ids and unknown artifact kinds are rejected here without touching 圖衍析,
and the documents are joined with a header per file.

The live test runs only when `WIREBOND_LIVE=1` and needs a 圖衍析 backend at
`LLMCAD_BASE_URL` (plus Ollama behind it); it pushes the 316D OCR markdown
through understand → search → draw → file download end to end.

    python -m pytest backend/tests/test_wirebond.py -q
    WIREBOND_LIVE=1 LLMCAD_BASE_URL=http://127.0.0.1:8000 LLMCAD_APP_TOKEN=... \
        python -m pytest backend/tests/test_wirebond.py -q -k live
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _app(monkeypatch, base_url: str, token: str = ""):
    monkeypatch.setenv("LLMCAD_BASE_URL", base_url)
    monkeypatch.setenv("LLMCAD_APP_TOKEN", token)
    import wirebond

    wirebond = importlib.reload(wirebond)
    app = FastAPI()
    app.include_router(wirebond.router)
    return TestClient(app), wirebond


# ── Offline ──────────────────────────────────────────────────────────────────
def test_disabled_status_is_not_an_error(monkeypatch):
    client, _ = _app(monkeypatch, "")
    r = client.get("/api/wirebond/status")
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "reachable": False, "base_url": "", "providers": {}, "llmcad": None}


def test_disabled_steps_answer_503(monkeypatch):
    client, _ = _app(monkeypatch, "")
    body = {"provider": "ollama", "model": "x", "documents": [{"filename": "a.md", "markdown": "# a"}]}
    assert client.post("/api/wirebond/understand", json=body).status_code == 503
    assert client.post("/api/wirebond/search", json={"netlist": {}}).status_code == 503
    assert client.get("/api/wirebond/job1/files/pdf").status_code == 503


def test_unreachable_status_reports_not_reachable(monkeypatch):
    client, _ = _app(monkeypatch, "http://127.0.0.1:9")  # nothing listens on the discard port
    r = client.get("/api/wirebond/status")
    assert r.status_code == 200
    j = r.json()
    assert j["enabled"] is True and j["reachable"] is False
    assert "連不到圖衍析" in j["error"]


def test_join_documents_headers_each_file(monkeypatch):
    _, wb = _app(monkeypatch, "")
    docs = [wb.DocumentIn(filename="pad.png", markdown="| Pad # |"),
            wb.DocumentIn(filename="empty.png", markdown="  "),
            wb.DocumentIn(filename="wafer.png", markdown="Wafer size ? 12")]
    text = wb.join_documents(docs)
    assert text.startswith("# Document 1: pad.png\n\n| Pad # |")
    assert "# Document 3: wafer.png" in text
    assert "empty.png" not in text


def test_empty_documents_rejected_before_forwarding(monkeypatch):
    client, _ = _app(monkeypatch, "http://127.0.0.1:9")
    body = {"provider": "ollama", "model": "x", "documents": [{"filename": "a.md", "markdown": ""}]}
    assert client.post("/api/wirebond/understand", json=body).status_code == 400


@pytest.mark.parametrize("job_id", ["..", "a/b", "x" * 65, "job;rm"])
def test_bad_job_id_rejected_locally(monkeypatch, job_id):
    client, _ = _app(monkeypatch, "http://127.0.0.1:9")
    r = client.get(f"/api/wirebond/{job_id}/files/pdf")
    assert r.status_code in (400, 404)


def test_unknown_artifact_kind_rejected_locally(monkeypatch):
    client, _ = _app(monkeypatch, "http://127.0.0.1:9")
    assert client.get("/api/wirebond/job1/files/exe").status_code == 400


def test_non_object_body_rejected(monkeypatch):
    client, _ = _app(monkeypatch, "http://127.0.0.1:9")
    assert client.post("/api/wirebond/search", content=b"[1,2]", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/api/wirebond/draw", content=b"nope", headers={"Content-Type": "application/json"}).status_code == 400


# ── Live (opt-in) ────────────────────────────────────────────────────────────
LIVE = os.getenv("WIREBOND_LIVE") == "1"
OCR_DIR = Path(os.getenv("WIREBOND_OCR_DIR", ""))


@pytest.mark.skipif(not LIVE, reason="set WIREBOND_LIVE=1 with a 圖衍析 backend at LLMCAD_BASE_URL")
def test_live_end_to_end(monkeypatch):
    client, _ = _app(monkeypatch, os.environ["LLMCAD_BASE_URL"], os.getenv("LLMCAD_APP_TOKEN", ""))
    st = client.get("/api/wirebond/status").json()
    assert st["reachable"], st
    assert "ollama" in st["providers"]

    docs = [{"filename": p.name, "markdown": p.read_text(encoding="utf-8")}
            for p in sorted(OCR_DIR.glob("ocr_*.md"))]
    assert docs, f"no ocr_*.md in {OCR_DIR}"
    model = os.getenv("WIREBOND_MODEL", st["providers"]["ollama"]["default_model"])
    r = client.post("/api/wirebond/understand", json={
        "provider": "ollama", "model": model, "documents": docs,
        "product_code": "316D", "customer": "ESMT",
        "extra_texts": ["AASP024MA02A1-24L MINIBGA (6x8x1.2mm)(P1.0)(B0.4)"],
    })
    assert r.status_code == 200, r.text
    read = r.json()
    nl = read["netlist"]
    assert len(nl["pads"]) == 12 and nl["package"]["ball_cols"] == 4 and nl["package"]["ball_rows"] == 6
    assert nl["wafer"] and nl["wafer"]["fab"] == "XMC"

    r = client.post("/api/wirebond/search", json={"netlist": nl, "top_k": 3})
    assert r.status_code == 200, r.text
    matches = r.json()["matches"]
    assert matches and matches[0]["score"] > 0.9

    r = client.post("/api/wirebond/draw", json={"netlist": nl, "reference_id": matches[0]["record"]["id"], "doc_no": "316D"})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["stats"]["wire_count"] == 12 and "pdf" in rep["formats"]

    pdf = client.get(f"/api/wirebond/{rep['job_id']}/files/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    png = client.get(f"/api/wirebond/{rep['job_id']}/files/png")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
