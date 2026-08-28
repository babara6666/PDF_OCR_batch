"""
Tests for the ERP import mode.

The normalisation tests are the important ones: rows arrive from an LLM, so
the shapes they come back in are the thing most likely to change without
warning, and a lot number silently turned into a float is an ERP row nobody
can trace back to the PDF.

    python -m pytest backend/tests/test_erp.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A client over a throwaway job store.

    ERP_JOBS_DIR is read at import time, so the module has to be imported
    fresh under the patched environment rather than reused across tests.
    """
    monkeypatch.setenv("ERP_JOBS_DIR", str(tmp_path / "jobs"))
    for mod in [m for m in sys.modules if m == "erp" or m.startswith("erp.")]:
        del sys.modules[mod]
    import erp

    app = FastAPI()
    app.include_router(erp.router)
    return TestClient(app)


def stage(client, filename="報告.pdf", markdown="# 檢驗報告\n", **kw):
    r = client.post(
        "/api/erp/jobs",
        json={"documents": [{"filename": filename, "markdown": markdown, **kw}]},
    )
    assert r.status_code == 201, r.text
    return r.json()["jobs"][0]["job_id"]


# ── Schema ───────────────────────────────────────────────────────────────────
def test_schema_is_the_seven_erp_columns_in_order(client):
    d = client.get("/api/erp/schema").json()
    assert [c["name"] for c in d["columns"]] == [
        "供應商批號",
        "檢驗項目",
        "單位",
        "規格",
        "規格上限",
        "規格下限",
        "檢驗結果",
    ]


def test_schema_carries_the_supplier_aliases(client):
    d = client.get("/api/erp/schema").json()
    by_key = {c["key"]: c for c in d["columns"]}
    # The two spellings that broke the old regex extractor most often.
    assert "L/C NO." in by_key["supplier_lot"]["aliases"]
    assert "实际值" in by_key["result"]["aliases"]
    # 簡體 reports are a normal case, not an exception.
    assert "批号" in by_key["supplier_lot"]["aliases"]


def test_schema_markdown_renders_for_the_mcp_resource(client):
    body = client.get("/api/erp/schema.md").text
    assert "ERP 匯入欄位定義" in body
    assert "`supplier_lot`" in body


# ── Staging ──────────────────────────────────────────────────────────────────
def test_staged_job_starts_pending_and_keeps_its_markdown(client):
    job_id = stage(client, markdown="# 南寶\n| 批號 | 24102102 |")
    d = client.get(f"/api/erp/jobs/{job_id}").json()
    assert d["status"] == "pending"
    assert "24102102" in d["markdown"]
    assert d["rows"] == []


def test_empty_markdown_is_recorded_as_failed_not_dropped(client):
    """A file OCR could not read still needs to be visible to a human."""
    job_id = stage(client, filename="掃描件.pdf", markdown="   ")
    d = client.get(f"/api/erp/jobs/{job_id}").json()
    assert d["status"] == "failed"
    assert d["error"]


def test_jobs_are_listed_newest_first_and_filter_by_status(client):
    stage(client, filename="a.pdf")
    b = stage(client, filename="b.pdf", markdown="")
    assert client.get("/api/erp/jobs").json()["count"] == 2
    failed = client.get("/api/erp/jobs", params={"status": "failed"}).json()
    assert [j["job_id"] for j in failed["jobs"]] == [b]


def test_batch_id_groups_an_upload(client):
    client.post(
        "/api/erp/jobs",
        json={
            "batch_id": "batch-1",
            "documents": [
                {"filename": "a.pdf", "markdown": "x"},
                {"filename": "b.pdf", "markdown": "y"},
            ],
        },
    )
    stage(client, filename="other.pdf")
    d = client.get("/api/erp/jobs", params={"batch_id": "batch-1"}).json()
    assert d["count"] == 2


# ── Dual-engine output ───────────────────────────────────────────────────────
def test_both_engine_outputs_are_kept_when_dual_mode_ran(client):
    """Same document, two renderings — the second is the digit cross-check."""
    job_id = stage(
        client,
        markdown="| 批號 | 2410Z1O2 |",
        engine="dual",
        alt_markdown="| 批號 | 24102102 |",
        alt_engine="fastdoc",
    )
    d = client.get(f"/api/erp/jobs/{job_id}").json()
    assert d["has_alt"] is True
    assert d["alt_engine"] == "fastdoc"
    assert "2410Z1O2" in d["markdown"]
    assert "24102102" in d["alt_markdown"]


def test_alt_variant_is_served_separately(client):
    job_id = stage(client, markdown="marker 版", alt_markdown="fastdoc 版")
    assert client.get(f"/api/erp/jobs/{job_id}/markdown").text == "marker 版"
    r = client.get(f"/api/erp/jobs/{job_id}/markdown", params={"variant": "alt"})
    assert r.text == "fastdoc 版"


def test_single_engine_jobs_report_no_alt(client):
    """Most reports are scans with no text layer — there is nothing to compare."""
    job_id = stage(client, markdown="只有一種輸出")
    d = client.get(f"/api/erp/jobs/{job_id}").json()
    assert d["has_alt"] is False
    assert d["alt_markdown"] == ""
    assert d["alt_engine"] == ""


def test_blank_alt_markdown_does_not_count_as_dual(client):
    job_id = stage(client, markdown="x", alt_markdown="   ", alt_engine="fastdoc")
    d = client.get(f"/api/erp/jobs/{job_id}").json()
    assert d["has_alt"] is False
    assert d["alt_engine"] == ""


def test_oversized_alt_markdown_is_refused(client):
    from erp import routes

    r = client.post(
        "/api/erp/jobs",
        json={
            "documents": [
                {
                    "filename": "big.pdf",
                    "markdown": "ok",
                    "alt_markdown": "x" * (routes.MAX_MARKDOWN_CHARS + 1),
                }
            ]
        },
    )
    assert r.status_code == 413


# ── Row normalisation ────────────────────────────────────────────────────────
def test_rows_accept_both_english_keys_and_chinese_column_names(client):
    job_id = stage(client)
    r = client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={
            "rows": [
                {"test_item": "固成份", "result": "40.12"},
                {"檢驗項目": "黏度", "檢驗結果": "14550"},
            ]
        },
    )
    rows = r.json()["rows"]
    assert [x["test_item"] for x in rows] == ["固成份", "黏度"]
    assert [x["result"] for x in rows] == ["40.12", "14550"]


def test_numeric_values_are_stringified_so_excel_cannot_coerce_them(client):
    """A lot number is an identifier. 24102102 must not become 24102102.0."""
    job_id = stage(client)
    r = client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={"rows": [{"supplier_lot": 24102102, "test_item": "x", "result": 40.12}]},
    )
    row = r.json()["rows"][0]
    assert row["supplier_lot"] == "24102102"
    assert row["result"] == "40.12"


def test_rows_with_no_required_field_are_dropped_and_reported(client):
    job_id = stage(client)
    r = client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={"rows": [{"unit": "%"}, {"test_item": "固成份", "result": "40"}]},
    )
    d = r.json()
    assert d["row_count"] == 1
    assert any("必填" in w for w in d["warnings"])


def test_unknown_keys_are_ignored_and_reported(client):
    job_id = stage(client)
    d = client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={"rows": [{"test_item": "x", "result": "1", "confidence": 0.9}]},
    ).json()
    assert "confidence" not in d["rows"][0]
    assert any("confidence" in w for w in d["warnings"])


def test_a_row_with_a_result_but_no_spec_survives(client):
    """The single most-reported miss of the old extractor: 規格 blank, 結果 present."""
    job_id = stage(client)
    d = client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={"rows": [{"test_item": "外觀", "spec": "", "result": "淡黃色透明液體"}]},
    ).json()
    assert d["row_count"] == 1
    assert d["rows"][0]["result"] == "淡黃色透明液體"


def test_resubmitting_rows_replaces_rather_than_appends(client):
    job_id = stage(client)
    body = {"rows": [{"test_item": "a", "result": "1"}, {"test_item": "b", "result": "2"}]}
    client.put(f"/api/erp/jobs/{job_id}/rows", json=body)
    d = client.put(
        f"/api/erp/jobs/{job_id}/rows", json={"rows": [{"test_item": "a", "result": "9"}]}
    ).json()
    assert d["row_count"] == 1
    assert d["status"] == "mapped"


# ── Export ───────────────────────────────────────────────────────────────────
def test_job_export_has_sheet1_and_context(client):
    import io

    from openpyxl import load_workbook

    job_id = stage(client, markdown="原文第一行\n原文第二行")
    client.put(
        f"/api/erp/jobs/{job_id}/rows",
        json={"rows": [{"supplier_lot": "24102102", "test_item": "固成份", "result": "40.12"}]},
    )
    r = client.get(f"/api/erp/jobs/{job_id}/export.xlsx")
    assert r.status_code == 200

    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Sheet1", "context"]
    assert wb["Sheet1"]["A1"].value == "供應商批號"
    assert wb["Sheet1"]["A2"].value == "24102102"
    assert wb["context"]["A1"].value == "原文第一行"


def test_batch_export_lists_unmapped_files_rather_than_dropping_them(client):
    import io

    from openpyxl import load_workbook

    good = stage(client, filename="good.pdf")
    bad = stage(client, filename="bad.pdf", markdown="")
    client.put(
        f"/api/erp/jobs/{good}/rows", json={"rows": [{"test_item": "x", "result": "1"}]}
    )
    r = client.get("/api/erp/export.xlsx", params={"job_ids": f"{good},{bad}"})
    wb = load_workbook(io.BytesIO(r.content))
    assert "彙總" in wb.sheetnames
    assert "未匯入" in wb.sheetnames
    assert wb["未匯入"]["A2"].value == "bad.pdf"


def test_csv_export_is_utf8_with_bom_for_excel(client):
    """Without the BOM, Excel on zh-TW Windows opens it as cp950 → mojibake."""
    job_id = stage(client)
    client.put(f"/api/erp/jobs/{job_id}/rows", json={"rows": [{"test_item": "外觀", "result": "OK"}]})
    r = client.get("/api/erp/export.csv", params={"job_ids": job_id})
    assert r.content.startswith(b"\xef\xbb\xbf")
    assert "檢驗項目" in r.content.decode("utf-8-sig")


# ── Safety ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("job_id", ["..", "../../etc/passwd", "not-hex", "0" * 32])
def test_malformed_or_unknown_job_ids_are_404_not_a_filesystem_walk(client, job_id):
    assert client.get(f"/api/erp/jobs/{job_id}").status_code == 404


def test_oversized_markdown_is_refused(client):
    from erp import routes

    r = client.post(
        "/api/erp/jobs",
        json={
            "documents": [
                {"filename": "big.pdf", "markdown": "x" * (routes.MAX_MARKDOWN_CHARS + 1)}
            ]
        },
    )
    assert r.status_code == 413


def test_deleted_job_is_gone(client):
    job_id = stage(client)
    assert client.delete(f"/api/erp/jobs/{job_id}").status_code == 200
    assert client.get(f"/api/erp/jobs/{job_id}").status_code == 404
