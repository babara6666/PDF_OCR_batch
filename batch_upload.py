"""
batch_upload.py — 自動分批上傳資料夾內所有 PDF 至 /api/upload-batch

用法：
    python batch_upload.py [資料夾路徑] [選項]

選項：
    --api       後端 API 位址  (預設 http://localhost:8001)
    --out       Markdown 輸出目錄 (預設 <資料夾>/output_md)
    --batch     每批檔案數      (預設 100)
    --force     略過品質檢查    (預設 True)
    --timeout   單批請求秒數    (預設 3600)
"""

import argparse
import json
import sys
import time
from contextlib import ExitStack
from pathlib import Path

import requests

# ── 斷點續傳記錄檔 ────────────────────────────────────────────────────────────
PROGRESS_FILE = "batch_upload_progress.json"


def load_progress(progress_path: Path) -> set[str]:
    if progress_path.exists():
        data = json.loads(progress_path.read_text(encoding="utf-8"))
        return set(data.get("done", []))
    return set()


def save_progress(progress_path: Path, done: set[str]) -> None:
    progress_path.write_text(
        json.dumps({"done": sorted(done)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── 單批上傳 ──────────────────────────────────────────────────────────────────
def upload_batch(
    files: list[Path],
    api_url: str,
    force: bool,
    timeout: int,
) -> list[dict]:
    endpoint = f"{api_url}/api/upload-batch"
    # 每個檔案都要保持開啟直到 POST 送完，所以用 ExitStack 一次管理整批的
    # 關閉——不管是正常結束還是中途丟例外，離開 with 就全部關掉。
    with ExitStack() as stack:
        multipart = [
            ("files", (f.name, stack.enter_context(open(f, "rb")), "application/pdf"))
            for f in files
        ]
        resp = requests.post(
            endpoint,
            files=multipart,
            params={"force": str(force).lower()},
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="批次上傳 PDF 至 OCR API")
    # 預設當前目錄。原本寫死的客戶資料夾路徑會把客戶名稱帶進版本控制，
    # 之後開源或交給包商就等於洩漏在處理誰家的圖。
    parser.add_argument("folder", nargs="?", default=".")
    parser.add_argument("--api", default="http://localhost:8001")
    parser.add_argument("--out", default=None)
    parser.add_argument("--batch", type=int, default=100)
    parser.add_argument("--force", action="store_true", default=True)
    parser.add_argument("--timeout", type=int, default=5400)
    args = parser.parse_args()

    src_dir = Path(args.folder)
    if not src_dir.is_dir():
        print(f"[錯誤] 找不到資料夾：{src_dir}")
        sys.exit(1)

    out_dir = Path(args.out) if args.out else src_dir / "output_md"
    out_dir.mkdir(parents=True, exist_ok=True)

    progress_path = src_dir / PROGRESS_FILE
    done = load_progress(progress_path)

    # 收集所有 PDF（排除已完成）
    all_pdfs = sorted(src_dir.glob("*.pdf"))
    pending = [f for f in all_pdfs if f.name not in done]

    total = len(all_pdfs)
    already = len(done)
    todo = len(pending)

    print(f"資料夾：{src_dir}")
    print(f"輸出：  {out_dir}")
    print(f"API：   {args.api}")
    print(f"每批：  {args.batch} 個檔案")
    print(f"總計：  {total} 個 PDF｜已完成：{already}｜待處理：{todo}")
    print("=" * 60)

    if todo == 0:
        print("所有檔案已處理完畢。")
        return

    # 分批處理
    batch_size = args.batch
    batches = [pending[i : i + batch_size] for i in range(0, todo, batch_size)]
    total_batches = len(batches)

    success_total = 0
    fail_total = 0
    fail_log: list[dict] = []

    for batch_idx, batch in enumerate(batches, 1):
        batch_start = time.time()
        print(f"\n[批次 {batch_idx}/{total_batches}] 上傳 {len(batch)} 個檔案…")

        try:
            results = upload_batch(batch, args.api, args.force, args.timeout)
        except requests.exceptions.Timeout:
            print(f"  ✗ 請求逾時（>{args.timeout}s），跳過本批次")
            fail_total += len(batch)
            for f in batch:
                fail_log.append({"filename": f.name, "error": "timeout"})
            continue
        except requests.exceptions.RequestException as e:
            print(f"  ✗ 連線錯誤：{e}，跳過本批次")
            fail_total += len(batch)
            for f in batch:
                fail_log.append({"filename": f.name, "error": str(e)})
            continue

        # 處理回傳結果
        for r in results:
            fname = r.get("filename", "")
            if r.get("success"):
                md_path = out_dir / (Path(fname).stem + ".md")
                md_path.write_text(r.get("markdown_content", ""), encoding="utf-8")
                done.add(fname)
                success_total += 1
            else:
                fail_total += 1
                fail_log.append({"filename": fname, "error": r.get("error", "unknown")})

        # 每批結束後儲存進度
        save_progress(progress_path, done)

        elapsed = time.time() - batch_start
        processed = already + success_total + fail_total
        pct = processed / total * 100
        print(
            f"  本批用時 {elapsed:.0f}s｜"
            f"累計 {processed}/{total} ({pct:.1f}%)｜"
            f"成功 {success_total}｜失敗 {fail_total}"
        )

    # ── 最終報告 ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"完成！成功：{success_total}｜失敗：{fail_total}")

    if fail_log:
        fail_path = src_dir / "batch_upload_failed.json"
        fail_path.write_text(
            json.dumps(fail_log, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"失敗清單已存至：{fail_path}")

    print(f"Markdown 輸出：{out_dir}")


if __name__ == "__main__":
    main()
