"""
Tests for locating a review-table value on the source page (erp/locate.py).

The fixture is a small COA-shaped table with a text layer, written by
make_fixture_pdf so no PDF library is needed. OCR is replaced by a fake engine:
what is under test is the matching and the coordinates, not rapidocr.

    python -m pytest backend/tests/test_erp_locate.py -q
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_fixture_pdf import PAGE_H, PAGE_W, build_pdf  # noqa: E402

# y in PDF points, bottom-up. The date line carries a "15" of its own, which
# is the decoy the row context has to beat.
DATE_Y, SOLID_Y, VISC_Y, DENS_Y = 740, 600, 570, 540
COA = [
    ("Date: 2024/10/15", 60, DATE_Y, 11, False),
    ("Item", 60, 630, 11, True),
    ("Spec", 260, 630, 11, True),
    ("Result", 420, 630, 11, True),
    ("Solid content", 60, SOLID_Y, 11, False),
    ("40~42", 260, SOLID_Y, 11, False),
    ("41", 420, SOLID_Y, 11, False),
    ("Viscosity", 60, VISC_Y, 11, False),
    ("10 ~ 20", 260, VISC_Y, 11, False),
    ("15", 420, VISC_Y, 11, False),
    ("Density", 60, DENS_Y, 11, False),
    ("150", 260, DENS_Y, 11, False),
    ("1.5", 420, DENS_Y, 11, False),
]


def frac_y(y_pt: float) -> float:
    """A baseline in PDF points as a page fraction from the top."""
    return 1 - y_pt / PAGE_H


def pdf_bytes(pages=None, rotate: int = 0) -> bytes:
    data = build_pdf(pages or [COA])
    if not rotate:
        return data
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(data)
    doc[0].set_rotation(rotate)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture()
def erp(tmp_path, monkeypatch):
    """A fresh erp package over a throwaway job store."""
    monkeypatch.setenv("ERP_JOBS_DIR", str(tmp_path / "jobs"))
    for mod in [m for m in sys.modules if m == "erp" or m.startswith("erp.")]:
        del sys.modules[mod]
    import erp

    return erp


@pytest.fixture()
def client(erp):
    app = FastAPI()
    app.include_router(erp.router)
    return TestClient(app)


def make_job(client, data: bytes) -> str:
    r = client.post("/api/erp/jobs", json={"documents": [{"filename": "coa.pdf", "markdown": "x"}]})
    job_id = r.json()["jobs"][0]["job_id"]
    r = client.post(
        f"/api/erp/jobs/{job_id}/source",
        files={"file": ("coa.pdf", data, "application/pdf")},
    )
    assert r.status_code == 201, r.text
    return job_id


def index_of(erp, data: bytes):
    from erp import locate, store

    job_id = store.create_job(filename="coa.pdf", markdown="x")
    store.save_source(job_id, data, 1)
    return locate.job_index(job_id)


# ── Text layer ───────────────────────────────────────────────────────────────
def test_table_cells_become_separate_segments(erp):
    (page,) = index_of(erp, pdf_bytes())
    assert page.source == "text"
    texts = [s.text for s in page.segments]
    # One segment per cell: a text match must never run from one cell into
    # the next, so the gap between columns has to split the line.
    assert "Viscosity" in texts
    assert "10 ~ 20" in texts
    assert "15" in texts


def test_the_row_context_beats_the_same_number_elsewhere(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes())
    hits = locate.find(pages, "15", ["Viscosity", "10 ~ 20"])
    assert len(hits) == 2  # the result cell, and the day in the date
    best = hits[0]
    assert best.context
    assert best.box[1] < frac_y(VISC_Y) < best.box[3] + 0.01
    assert best.box[0] == pytest.approx(420 / PAGE_W, abs=0.01)


def test_numbers_match_whole_not_inside_other_numbers(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes())
    texts = {h.text for h in locate.find(pages, "15")}
    # 150 and 1.5 both contain the characters "15"; neither is 15.
    assert "150" not in texts
    assert "1.5" not in texts
    assert "15" in texts


def test_same_value_written_differently_still_matches(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes())
    (hit,) = locate.find(pages, "41.0")
    assert hit.text == "41"
    assert hit.score < 1.0  # found by value, ranked below the printed form


def test_a_number_inside_a_range_is_framed_on_its_own(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes())
    seg = next(s for s in pages[0].segments if s.text == "10 ~ 20")
    (hit,) = [h for h in locate.find(pages, "20") if h.text == "10 ~ 20"]
    # Only the "20", not the whole cell.
    assert hit.box[0] > seg.box[0] + 0.02
    assert hit.box[2] == pytest.approx(seg.box[2], abs=0.005)


def test_text_and_full_width_forms(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes())
    assert locate.find(pages, "viscosity")[0].text == "Viscosity"
    # Full-width tilde and digits, as scans and CJK reports print them.
    assert locate.find(pages, "４０～４２")[0].text == "40~42"
    assert locate.find(pages, "Not on the page") == []


def test_rotated_page_boxes_follow_the_rendered_image(erp):
    from erp import locate

    pages = index_of(erp, pdf_bytes(rotate=90))
    hit = locate.find(pages, "Solid content")[0]
    x0, y0, x1, y1 = hit.box
    # Written left to right on the page, so after a quarter turn it runs
    # top to bottom on the rendered image.
    assert (y1 - y0) > (x1 - x0)
    assert all(0 <= v <= 1 for v in hit.box)


# ── Scans ────────────────────────────────────────────────────────────────────
class FakeOcr:
    """Stands in for rapidocr: one text line at a fixed place."""

    calls = 0

    def __call__(self, image, **_):
        FakeOcr.calls += 1
        h, w = image.shape[:2]
        poly = [[0.5 * w, 0.2 * h], [0.6 * w, 0.2 * h], [0.6 * w, 0.22 * h], [0.5 * w, 0.22 * h]]
        return [[poly, "黏度 15 cps", 0.99]], None


def test_a_scan_is_read_by_ocr_once(erp, monkeypatch):
    from erp import locate

    FakeOcr.calls = 0
    monkeypatch.setattr(locate, "_get_ocr", lambda: FakeOcr())
    blank = pdf_bytes(pages=[[]])
    from erp import store

    job_id = store.create_job(filename="scan.pdf", markdown="x")
    store.save_source(job_id, blank, 1)

    (page,) = locate.job_index(job_id)
    assert page.source == "ocr"
    (hit,) = locate.find([page], "15", ["黏度"])
    assert hit.context
    x0, y0, x1, y1 = hit.box
    # Narrowed to the number inside the OCR line, by character offset.
    assert 0.5 < x0 and x1 < 0.6
    assert y0 == pytest.approx(0.2, abs=0.001)

    locate.job_index(job_id)
    assert FakeOcr.calls == 1  # the second read comes from the cache


def test_a_scan_without_ocr_is_reported_and_not_cached(erp, monkeypatch):
    from erp import locate, store

    monkeypatch.setattr(locate, "_get_ocr", lambda: None)
    job_id = store.create_job(filename="scan.pdf", markdown="x")
    store.save_source(job_id, pdf_bytes(pages=[[]]), 1)

    (page,) = locate.job_index(job_id)
    assert page.source == "none"
    # Installing OCR later must make the scan searchable without a cache purge.
    assert not (store.pages_dir(job_id) / "1.lines.json").exists()


# ── Endpoints ────────────────────────────────────────────────────────────────
def test_locate_endpoint(client):
    job_id = make_job(client, pdf_bytes())

    r = client.get(f"/api/erp/jobs/{job_id}/text-index")
    assert r.status_code == 200
    assert r.json()["pages"][0]["source"] == "text"

    r = client.get(
        f"/api/erp/jobs/{job_id}/locate", params={"q": "15", "ctx": ["Viscosity", "10 ~ 20"]}
    )
    assert r.status_code == 200
    d = r.json()
    assert d["searchable"] is True
    assert d["hits"][0]["page"] == 1
    assert d["hits"][0]["context"] is True
    assert d["hits"][0]["box"][1] == pytest.approx(frac_y(VISC_Y), abs=0.03)


def test_locate_needs_a_stored_pdf(client):
    r = client.post("/api/erp/jobs", json={"documents": [{"filename": "a.pdf", "markdown": "x"}]})
    job_id = r.json()["jobs"][0]["job_id"]
    assert client.get(f"/api/erp/jobs/{job_id}/locate", params={"q": "15"}).status_code == 404
    assert client.get(f"/api/erp/jobs/{'0' * 32}/locate", params={"q": "15"}).status_code == 404


def test_a_new_source_pdf_drops_the_old_index(client):
    from erp import store

    job_id = make_job(client, pdf_bytes())
    client.get(f"/api/erp/jobs/{job_id}/text-index")
    assert (store.pages_dir(job_id) / "1.lines.json").exists()

    other = [[("Hardness", 60, 700, 11, False), ("88", 260, 700, 11, False)]]
    client.post(
        f"/api/erp/jobs/{job_id}/source",
        files={"file": ("coa.pdf", pdf_bytes(pages=other), "application/pdf")},
    )
    hits = client.get(f"/api/erp/jobs/{job_id}/locate", params={"q": "Hardness"}).json()["hits"]
    assert hits and hits[0]["text"] == "Hardness"
