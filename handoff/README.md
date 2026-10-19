# 規格析（PrintLens）交接文件

> 整理日期：2026-10-19　｜　分支：`feat/wirebond-tab`　｜　正式 repo：http://git.fst/Stanley/PDF_OCR.git

## 這是什麼

批次 PDF／圖片 OCR 轉 Markdown 的 Web 服務，以開源的 [datalab-to/marker](https://github.com/datalab-to/marker) 為 OCR 核心，
外面包了 FastAPI 後端與 React 前端。後來陸續加上：

- **fastdoc 快速路徑**：有文字層的電子檔不跑 OCR，直接抽文字
- **ERP 匯入模式**：供應商進料檢驗報告（COA）→ LLM 對應成 ERP 欄位 → 人工覆核 → 匯出 xlsx/csv（客戶：四維）
- **打線圖模式**：把 OCR 結果交給另一個專案「圖衍析（LLMCAD3）」畫打線圖（**目前隱藏**）
- **Notes 模式**：用 YOLO 抓工程圖的 Notes 區塊（**目前隱藏**）

產品名稱曾經改過：PDF_OCR → PrintLens → **規格析**，程式碼與 image 名稱裡三種都會看到。

## 閱讀順序

| 檔案 | 內容 | 什麼時候看 |
|---|---|---|
| [01_現有功能.md](01_現有功能.md) | 每個模式做什麼、開關在哪、API 一覽 | 第一天 |
| [02_注意事項.md](02_注意事項.md) | 踩過的坑、公司機限制、不要碰的東西 | **改任何東西之前** |
| [03_Source_Code導覽.md](03_Source_Code導覽.md) | 目錄結構、每個檔案負責什麼、怎麼在本機跑、怎麼跑測試 | 開始寫程式時 |
| [04_未完成事項.md](04_未完成事項.md) | 已知 bug、最近一次修改內容、還沒開放的功能、待辦清單 | 排工作時 |

## 一分鐘摘要

- **目前在用的交付版本**：`PrintLens_20261004/`（離線 docker image，all-in-one，GPU）。打包說明在該資料夾的 `README.md` 與 `VERSION`。這個資料夾（7GB）**不在 git 裡**，要另外向原作者拿。
- **現況**：後端 pytest 116 passed／1 skipped，前端 `node --test` 12/12（2026-10-19 在本機跑過）。
- **最優先處理**：
  1. 10/13 的修改（新客戶可以從覆核結果長出自己的設定檔）已 commit，但還沒包進任何交付包。
  2. 修 VERSION 裡列的 4 個 ERP 已知問題（限流、重複對應、卡 event loop、切換報告寫錯列）。
  3. `main` 分支落後 `feat/wirebond-tab` 12 個 commit，需要合併。
- **既有的詳細文件**（本資料夾不重複抄，只指路）：
  - 根目錄 `README.md` — 最完整的功能與設定說明（ERP、fastdoc、打線圖、環境變數都在裡面）
  - `mcp_server/README.md` — 知識通 MCP server 怎麼架
  - `security-audit-report.md` — 2026-08-13 資安審計
  - `TODO_FOR_OPUS.md` — 2026-08-13 的待修清單（大部分已修，現況見 04）
  - `PrintLens_20261004/README.md`、`VERSION` — 最新交付包的安裝方式與已知限制
