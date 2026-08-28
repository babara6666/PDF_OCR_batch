# Batch PDF/Image OCR Service

基於 [datalab-to/marker](https://github.com/datalab-to/marker) 的批次 PDF/圖片轉 Markdown 服務，提供 Web 前端介面支援多檔案批次上傳、即時狀態追蹤，並輸出對應的 Markdown 檔案。

## 功能特色

- 🚀 **高效批次轉換**: 支援多份檔案同時上傳與背景佇列處理
- 🖼️ **多種圖片支援**: 支援 PDF 與多種圖片格式 (JPG, PNG, GIF, WEBP, BMP, TIFF)
- 🎯 **多語言支援**: 支援中英日韓等多國語言 OCR
- 📊 **表格識別**: 自動識別並格式化 PDF 中的表格
- 🔢 **數學公式**: 支援 LaTeX 數學公式提取
- ⚡ **GPU 加速**: 支援 CUDA GPU 加速處理
- 📦 **打包下載**: 批次轉換完成後自動整理與下載結果
- 🏭 **ERP 匯入模式**: 供應商進料檢驗報告（COA）交給知識通做欄位對應，覆核後匯出 ERP 匯入檔（見下方「ERP 匯入模式」）

---

## 快速啟動（Docker）

只需安裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，無需 Python 或 Node.js 環境。

### CPU 版本

```bash
# 1. 複製環境變數範本
cp .env.example .env

# 2. 建置並啟動（首次執行會下載 ~2-3GB 模型，請耐心等候）
docker compose up -d --build

# 3. 確認服務狀態（backend: healthy / frontend: healthy）
docker compose ps
```

開啟瀏覽器訪問 **http://localhost**

### GPU 版本（需要 NVIDIA Container Toolkit）

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

> 安裝 NVIDIA Container Toolkit：https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

### 常用指令

```bash
# 查看後端 log（含模型載入進度）
docker compose logs -f backend

# 停止服務
docker compose down

# 停止並刪除模型快取 volume（重新下載模型）
docker compose down -v

# 重新建置（程式碼更新後）
docker compose up -d --build
```

### 架構說明

```
Browser → nginx :80
            ├── /api/*  → FastAPI :8001 (容器內部，不對外)
            └── /*      → React SPA 靜態檔
```

後端 port 不對外暴露，所有流量統一從 port 80 進入。
模型快取存放於 Docker Volume `model_cache`，重啟後無需重新下載。

---

## 單一 Image 部署（All-in-one）

前端靜態檔與後端打包在同一個 image 中，適合無法使用 docker-compose 的遠端環境。

### 建置

```bash
# CPU 版
docker build -f Dockerfile.allinone -t printlens:latest .

# GPU 版（CUDA 12.6）
docker build -f Dockerfile.allinone --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126 -t printlens:gpu .

# GPU 版（CUDA 12.8）
docker build -f Dockerfile.allinone --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128 -t printlens:gpu .
```

### 啟動

```bash
# GPU 版，對外 port 9000
docker run -d -p 9000:80 -v model_cache:/models --gpus all --name printlens printlens:gpu

# CPU 版
docker run -d -p 9000:80 -v model_cache:/models --name printlens printlens:latest
```

開啟瀏覽器訪問 **http://localhost:9000**（或指定的 port）

### 常用指令

```bash
# 查看 log（含模型載入與 nginx 狀態）
docker logs -f printlens

# 停止
docker stop printlens

# 再次啟動
docker start printlens

# 刪除容器（保留 image）
docker rm -f printlens

# 刪除容器與 image
docker rm -f printlens && docker rmi printlens:gpu
```

### 架構說明

```
Browser → nginx :80 (對外 port 可自訂)
            ├── /api/*  → uvicorn 127.0.0.1:8001 (容器內部)
            └── /*      → React SPA 靜態檔 (/usr/share/nginx/html)
```

nginx 與 uvicorn 由 supervisor 在同一容器內管理。

---

## 本機開發（不使用 Docker）

### 系統需求

- Python 3.10+
- Node.js 18+
- CUDA GPU（建議，可用 CPU 但較慢）
- ~3GB 磁碟空間（模型下載）

### 安裝

```bash
# 後端依賴
cd backend
uv pip install -r requirements.txt

# 安裝 marker 套件（專案根目錄）
uv pip install -e .

# 前端依賴
cd ../frontend
npm install
```

### 啟動

```bash
# 後端 (Port 8001)
cd backend
python main.py

# 前端 (Port 5173)
cd frontend
npm run dev
```

開啟瀏覽器訪問 **http://localhost:5173**

---

## 專案結構

```
PDF_OCR_FS/
├── Dockerfile.backend        # 後端多階段建構
├── Dockerfile.frontend       # 前端多階段建構 + Nginx
├── docker-compose.yml        # CPU 版本編排
├── docker-compose.gpu.yml    # GPU override
├── nginx.conf                # Nginx 反向代理設定
├── .env.example              # 環境變數範本
├── backend/
│   ├── main.py               # FastAPI 主程式
│   ├── quality_checker.py    # OCR 前品質檢查
│   ├── notes_extractor.py    # 工程圖 Notes 區段提取
│   ├── erp/                  # ERP 匯入模式（OCR → 知識通 → 匯入檔）
│   │   ├── schema.yaml       #   7 個 ERP 欄位 + 供應商欄名別名（唯一事實來源）
│   │   ├── schema.py         #   讀 schema、正規化知識通回填的列
│   │   ├── store.py          #   檔案式 job 儲存（雙軌兩份 MD 都留，等知識通來拿）
│   │   ├── export.py         #   產出 xlsx / csv 匯入檔
│   │   └── routes.py         #   /api/erp/*
│   ├── bench_fastdoc.py      # 快速路徑 vs Marker 的量測工具
│   ├── fastdoc/              # 免模型快速路徑（anydoc 架構移植）
│   │   ├── detect.py         #   1. 依內容判斷格式
│   │   ├── model.py          #   2. 共用 document model
│   │   ├── serialize.py      #   3. 單一 GFM serializer
│   │   ├── router.py         #   分流：走快速路徑還是 OCR
│   │   └── parsers/          #   pdf.py / office.py
│   ├── tests/                # pytest 測試與 PDF fixture 產生器
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── services/api.js
│   └── package.json
├── mcp_server/               # 給知識通接的 MCP server（獨立環境）
│   ├── specocr_mcp.py        #   erp_list_jobs / erp_get_markdown / erp_submit_rows …
│   └── reference/            #   欄位定義、版型陷阱、要上傳到知識通的 skill
├── marker/                   # Marker OCR 核心模組
└── pyproject.toml            # Marker 套件配置
```

---

## ERP 匯入模式（進料檢驗報告 → 知識通 → ERP）

第三個分頁。前半段跟一般 OCR 完全一樣（同樣的引擎、同樣的品質檢查），
差別在辨識完的 Markdown 不是直接給你下載，而是**暫存成待處理的 job**，
由知識通讀懂內容、對應成 ERP 欄位後回填。

```
上傳 PDF ─► OCR ─► 暫存為 job ─┐
                                │  MCP（知識通主動來拿）
   ERP 匯入檔 ◄── 人工覆核 ◄─────┘
```

**為什麼要 LLM 而不是繼續寫規則**：每家供應商叫法都不同——
`批號` / `Lot No.` / `L/C NO.` / `代工原料卷號` / `批号` 全是同一個東西，
`檢驗結果` 有 37 種寫法。既有做法是人工維護的別名對照表用字串比對，
38 份實測報告跑了三輪仍有一半出現「特殊規格 / 未抓到 / 辨識錯誤」，
而且每來一個新供應商就要再補一次。改成讓知識通照語意判斷後，
那份 163 筆的別名清單降級成**提示**，沒看過的欄名變成正常情況而不是失敗。

輸出欄位固定 7 欄，與現行人工作業的 Excel 一致：

```
供應商批號 | 檢驗項目 | 單位 | 規格 | 規格上限 | 規格下限 | 檢驗結果
```

### 雙軌輸出怎麼交給知識通

檔案帶有文字層時會跑雙軌，兩份輸出**都**存進 job，知識通一次拿到兩份：

| | 內容 | 用途 |
|---|---|---|
| `markdown` | Marker 還原的版面 | 表格結構——判斷哪一欄是什麼 |
| `alt_markdown` | fastdoc 直接抄的文字層 | 精確字元——數字、批號不會辨識錯 |

兩份是**同一份文件**，所以 `erp_get_markdown` 會在開頭明講這件事再附上兩段。
不講的話，讀到同一張表兩次會被當成兩份報告，列數直接變兩倍。

值得多花這些 token 是因為兩者的失誤剛好互補：Marker 可能把 `24102102` 讀成
`2410Z1O2`，但欄位分得對；fastdoc 抄來的字元不會錯，但版面是平的。
結構看前者、數字看後者，覆核紀錄裡「辨識錯誤」那一類大多就消掉了。

掃描件沒有文字層，只會有一份——那是正常情況，不是降級。

### 啟用

1. 依 `mcp_server/README.md` 架好 MCP server，把公開的 `https://…/mcp`
   註冊到知識通。
2. 把 `mcp_server/reference/zhishitong-skill-erp-import.md` 上傳成知識通的 skill。
3. 把 `frontend/src/config.js` 的 `ERP_ENABLED` 改成 `true`，重建前端。

預設是關的：沒有接上知識通的話，每份報告都會卡在「等待中」沒有辦法往下走。

### 新增供應商欄名

改 `backend/erp/schema.yaml` 對應欄位的 `aliases` 就好，存檔即生效
（後端偵測 mtime 重讀，MCP server 也是即時取用），不需要重啟或重新部署。

### 相關環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `ERP_JOBS_DIR` | `backend/erp_jobs` | 暫存 job 的位置 |
| `ERP_JOBS_RETENTION_DAYS` | `14` | 超過就自動清掉（內含客戶檢驗資料） |
| `ERP_JOBS_MAX` | `2000` | job 數量上限，超過從最舊的刪 |

---

## 快速路徑 fastdoc（免模型、免 GPU）

`backend/fastdoc/` 是一條放在 Marker 前面的分流器，架構移植自
[firecrawl/anydoc](https://github.com/firecrawl/anydoc) 的三段式設計：

```
1. detect      依檔案內容（magic bytes / ZIP mimetype / OLE stream）判型，不信副檔名
2. parse       每種格式一個 parser，全部產出同一份 document model
3. serialize   單一 GFM serializer 負責所有格式的輸出與跳脫
```

**anydoc 本身完全不做 OCR**，所以這不是 Marker 的替代品，而是它的前置分流：

| 輸入 | 走哪條路 |
|------|----------|
| 自帶文字層的電子檔 PDF（CAD/Office 匯出） | fastdoc，毫秒級，不碰 GPU |
| 掃描件 PDF、所有圖片格式 | Marker OCR，行為完全不變 |
| docx / xlsx / pptx / csv / txt | fastdoc（原本不支援的新格式） |

判斷依據是文字層探測（每頁字元數、有文字的頁面比例、字元對應是否損毀），
只讀文字物件、不算繪製頁面，成本約數毫秒。

### 開啟自動分流

```bash
# .env
FASTDOC_ROUTING=1
```

開啟後 `/api/upload` 與 `/api/upload-batch` 會先試快速路徑，失敗才回落 OCR。
回應多一個 `engine` 欄位（`fastdoc` 或 `marker`）標示實際走哪條路。
**掃描件的處理結果不受影響**——快速路徑只會少做工，不會降低輸出品質。

### 雙軌輸出（同一份文件兩種結果）

分流模式是「有文字層就用 fastdoc **取代** Marker」。雙軌模式則是**兩種都跑、兩份都回**，
因為兩者的失敗方向不同：

| | 強項 | 弱項 |
|---|------|------|
| **Marker** | 重建版面：閱讀順序、表格結構、標題階層 | 文字是模型的辨識結果，可能認錯字 |
| **fastdoc** | 直接複製檔案內既有的字元，**一個字都不會錯** | 結構是從座標與字級「猜」出來的 |

沒有哪一邊絕對比較好，值得覆核的文件就兩份都留著比對。

```bash
# .env
FASTDOC_ROUTING=1
FASTDOC_DUAL=1
```

也可以每次請求指定，不必改設定重啟：

```bash
curl -X POST "http://localhost:8001/api/upload?dual=true" -F "file=@spec.pdf"
```

回應中 `engine` 會是 `dual`，`markdown_content` 是 Marker 的版面重建結果，
`fastdoc_markdown` 是原文字層，另外附上 `marker_time` 與 `fastdoc_time` 方便比較成本。

前端「雙軌輸出」開關會覆寫 `FASTDOC_DUAL` 預設值；結果頁的預覽區會多出
**Marker · 排版** / **文字層 · 原文** 切換，下載時兩份都會存成
`<檔名>.marker.md` 與 `<檔名>.fastdoc.md`。

掃描件不受影響——沒有文字層就沒有第二份可比，照常只走 Marker。

### 先量測再決定

在自己的檔案上跑，看快速路徑對你的語料有沒有價值：

```bash
cd backend

# 1. 只做分流統計，不載入任何模型（先跑這個）
python bench_fastdoc.py triage D:\your\batch\folder

# 2. 只跑快速路徑，輸出 markdown
python bench_fastdoc.py fast D:\your\batch\folder --out md_out

# 3. 兩條路都跑，比時間、字數與文字一致度（會載入 Marker 模型，建議在 GPU 環境跑）
python bench_fastdoc.py compare D:\your\batch\folder --limit 10 --out md_out --json result.json
```

`triage` 的輸出會直接告訴你有多少比例的檔案可以跳過 OCR。如果是 0%，
代表你的語料全是掃描件，這條路對你沒有價值，可以直接不開。

### 測試

```bash
python -m pytest backend/tests/test_fastdoc.py -q
```

---

## API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/` | GET | API 資訊與支援格式 |
| `/api/health` | GET | 健康檢查（含模型載入狀態） |
| `/api/upload` | POST | 單一檔案 OCR 轉換（`?dual=true` 兩種引擎都輸出） |
| `/api/upload-batch` | POST | 批次 OCR 轉換（最多 50 檔，同樣支援 `?dual=true`） |
| `/api/check-quality-batch` | POST | 批次品質預檢（不執行 OCR） |
| `/api/convert-fast` | POST | 快速路徑轉換（免模型；掃描件回 422） |
| `/api/triage-batch` | POST | 批次分流：判斷每個檔要走 OCR 還是快速路徑 |
| `/api/extract-notes` | POST | 單一工程圖 Notes 區段提取 |
| `/api/extract-notes-batch` | POST | 批次工程圖 Notes 區段提取 |

### 上傳範例

```bash
# 單一檔案
curl -X POST http://localhost/api/upload \
  -F "file=@document.pdf"

# 批次上傳
curl -X POST http://localhost/api/upload-batch \
  -F "files=@doc1.pdf" -F "files=@doc2.pdf"
```

回應格式：
```json
{
  "success": true,
  "filename": "document.pdf",
  "markdown_content": "# Title\n...",
  "file_size": 12345,
  "processing_time": 5.67,
  "engine": "marker"
}
```

`engine` 標示實際用了哪條路：`marker`（OCR）、`fastdoc`（純文字層抽取）、
或 `dual`（兩種都跑）。`dual` 時會多出 `fastdoc_markdown`、`fastdoc_time`、`marker_time`。

---

## 存取控制與資源上限

這些預設值可以直接跑，但對外開放前請一併調整。完整清單見 `.env.example`。

| 變數 | 預設 | 說明 |
|------|------|------|
| `API_KEY` | 空（不驗證） | 設了之後所有 `/api/*` 都要帶 `X-API-Key` header；`/api/health` 永遠不驗證，否則容器健康檢查會失敗 |
| `RATE_LIMIT_REQUESTS` | `60` | 每個 IP 在 `RATE_LIMIT_WINDOW` 秒內的請求上限，`0` = 關閉 |
| `RATE_LIMIT_WINDOW` | `60` | 上面那個窗口的秒數 |
| `MAX_BATCH_FILES` | `50` | 單一批次最多幾個檔 |
| `MAX_UNCOMPRESSED_SIZE` | `200MB` | docx/xlsx/pptx 解壓後的上限（壓縮炸彈防護） |
| `MARKER_CONCURRENCY` | `1` | 同時能有幾份文件進 Marker；Marker 佔著 GPU，預設序列化 |
| `WORKER_THREADS` | `4` | 品質檢查 / fastdoc / 檔案寫入用的 thread 數 |

帶 API key 的呼叫方式：

```bash
curl -X POST http://localhost/api/upload \
  -H "X-API-Key: <你的金鑰>" \
  -F "file=@document.pdf"
```

nginx 那層另外有 `limit_req` / `limit_conn`（2 req/s、burst 20、每 IP 8 條連線）
與 `client_max_body_size 300M`。**300M 是跟著 `MAX_BATCH_FILES` 走的**——
調大批次上限時，`nginx.allinone.conf` 也要一起改。

> 前端呼叫 API 一律用相對路徑 `/api/*`，dev 由 vite proxy 轉、prod 由 nginx 轉。
> 除非後端真的在別的 origin，否則**不要**設 `VITE_API_BASE_URL`——寫死絕對網址
> 會讓區網使用者的瀏覽器去打他自己的 localhost。

---

## 技術棧

- **後端**: FastAPI + Uvicorn
- **前端**: React + Vite + TailwindCSS
- **OCR 引擎**: Marker (Surya + Texify)
- **深度學習**: PyTorch (CUDA)
- **部署**: Docker + Nginx

## 授權

- 程式碼: GPL License
- Marker 模型: AI Pubs Open Rail-M License

## 致謝

基於 [datalab-to/marker](https://github.com/datalab-to/marker) 開發
