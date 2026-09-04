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
# GPU 版，對外 port 9000。不要把 named volume 掛在 /models 上：
# 單一 image 的權重已經烤在 /models 裡，掛上去會把它們蓋掉。
docker run -d -p 9000:80 --gpus all --name printlens printlens:gpu

# CPU 版
docker run -d -p 9000:80 --name printlens printlens:latest
```

開啟瀏覽器訪問 **http://localhost:9000**（或指定的 port）

### 離線交付測試注意事項（PrintLens_20260904）

測試人員測的是資料夾 `PrintLens_20260904/`（`docker load` 現成 image），不是 git clone、也不用 `--build`。

- 整包拷貝，不要只傳 `.tar`。Windows 用 `.\load.cmd`；若擋「未經數位簽署」，不要改 ExecutionPolicy，改跑 `powershell -NoProfile -ExecutionPolicy Bypass -File .\load.ps1`。
- 先 `docker rm -f printlens`。啟動後等 1–3 分鐘，`/api/health` 要 `"model_loaded":true` 再上傳。
- 第一次用無痕視窗開 http://127.0.0.1:8080。開過舊版的瀏覽器會把舊 JS 快取一年，畫面會繼續噴 `Unsupported protocol C:`。
- 確認頁面是 `index-CoXUUwBL.20260904.js`。品質檢查出現 `poor sharpness (score=…, threshold=2.0)` 是門檻警告，勾選後仍可開始 OCR；那不是部署失敗。

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
│   │   ├── schema.yaml       #   內建 default 設定檔（四維的 7 欄 + 別名）
│   │   ├── profiles/         #   其他客戶的設定檔，執行時建立（不進 git）
│   │   ├── learn.py          #   從 key.xlsx／已做過的報告學出一份設定檔
│   │   ├── schema.py         #   讀設定檔、正規化回填的列、驗證新設定檔
│   │   ├── store.py          #   檔案式 job 儲存（雙軌兩份 MD、原始 PDF、覆核狀態）
│   │   ├── pages.py          #   把原始 PDF 算成頁面圖，給覆核畫面並排對照
│   │   ├── llm.py            #   連不到知識通時，改叫本機 Ollama／公司 gateway
│   │   ├── reference/        #   版型陷阱清單（llm.py 與 MCP resource 共用）
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
上傳 PDF ─► OCR ─► 暫存為 job（PDF 也一起留著）─┐
                                                 │  MCP（知識通主動來拿）
   ERP 匯入檔 ◄── 確認無誤 ◄── 對照原始 PDF 覆核 ◄┘
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

### 連不到知識通時：讓後端自己叫模型

知識通是 MCP **host**——它是被人叫來拿工作的，後端推不動它。工廠端連不到知識通
時，整批報告就會卡在「等待中」。所以後端也可以自己叫一個模型做同一件事：

```bash
ERP_LLM_PROVIDERS=ollama,gateway     # 依序嘗試，本機優先
OLLAMA_BASE_URL=http://localhost:11434
GATEWAY_BASE_URL=http://llmgateway.fst:4000/v1
GATEWAY_API_KEY=...                  # gateway 才需要
```

設了以後覆核頁上方會多一個「對應引擎」選單（本機模型／公司 gateway／知識通），
選好按「開始對應」就直接跑，不必到知識通貼指令。模型清單是跟伺服器要的
（Ollama 問 `/api/tags`、gateway 問 `/v1/models`），`ollama pull` 完就會出現；
伺服器連不到時退回內建清單，**下拉選單不會變空**。

留空（預設）＝完全維持原本行為，選單不會出現。

前面的 provider 失敗就換下一個；全部失敗時 job **留在「等待中」**而不是「失敗」——
文件本身沒問題，只是這一次沒跑成，知識通仍然可以接手，清單上也會顯示原因與「重試」。

**要有心理準備**：遇到沒看過的供應商欄名時，本機 8B–35B 模型判斷得比知識通差，
而那正是當初從 regex 改用 LLM 的唯一理由。擋在前面的是上面那道人工確認閘門，
不是樂觀。上線前建議拿 `測試紀錄251117.xlsx` 的三輪覆核紀錄當答案，實測正確率。

### 覆核：並排原文，確認過才匯得出去

對應完的報告會停在覆核畫面，**左邊是原始 PDF 的頁面、右邊是可以直接改的表格**。
逐格對照、缺的列補上、多出來的掃描雜訊刪掉，確定沒問題再按「確認無誤」。

匯出**預設只收已確認的報告**，沒確認的會列在活頁簿的「未匯入」分頁（原因寫
「尚未確認」），不會被無聲丟掉。真的趕時間可以勾「連未確認的一起匯出」。
存過修改之後確認狀態會自動取消——按確認的人必須看過的是實際存下來的那一版。

左邊顯示的是**後端算出來的頁面圖**，不是內嵌的 PDF 閱讀器：本專案的 CSP 設了
`object-src 'none'` 與 `frame-ancestors 'none'`，同源也擋內嵌 PDF。改用圖片不必
動那兩個標頭；而且這些報告多半本來就是掃描件，沒有文字層可以選取。要看純文字
時按「原始 Markdown」。

原始 PDF 由前端在辨識完之後才補傳（`POST /api/erp/jobs/{id}/source`），不擋表格
出現。批次匯入或補傳失敗的報告沒有頁面圖，畫面會說明並要你改用 Markdown 對照。

### 客戶設定檔：換一個客戶不用改程式

一個設定檔＝一個客戶的答案：他們的 ERP 匯入範本要哪些欄位，以及他們的供應商
怎麼稱呼那些東西。**兩者都會不一樣**——`schema.yaml` 那 7 欄是四維的範本，
不是業界標準——所以設定檔擁有欄位定義本身，不只是別名。

```
backend/erp/schema.yaml        內建的 default 設定檔（四維）
<ERP_PROFILES_DIR>/<id>.yaml   一個客戶一個檔，格式相同（執行時建立）
```

上傳畫面選設定檔，這批報告就用它的欄位與別名讀；job 會記住自己是哪一個設定檔，
所以之後換客戶也不影響上週的匯出。一個活頁簿只有一種表頭，所以跨設定檔的批次
不會硬湊在一起——設定檔不同的那幾份會列在「未匯入」。

#### 怎麼生出一份新設定檔

不必手寫。客戶手上已經有的兩種檔案就帶著答案：

1. **他們的別名對照表（`key.xlsx`）** — 欄＝ERP 欄位、格子＝各家供應商寫法。
   「管理設定檔 → 匯入別名對照表」直接讀進來，**完全不經過模型**：那張表本身
   就是對應關係，讓模型改寫只會變差。四維的真實 `key.xlsx` 匯入後是 7 欄 154
   種寫法，其中 152 種與手工維護了幾個月的 `schema.yaml` 相同。

2. **他們已經做過的報告** — 幾份 COA，外加當初為每一份填好的匯入 xlsx。
   只有 PDF 是不夠的：PDF 說得出供應商怎麼寫，說不出「你們判斷那是哪一欄」，
   而那個判斷正是 `key.xlsx` 當年被人做出來的東西。附上答案才補得回來。
   加了樣本與答案之後按「產生設定檔草稿」，由已設定的 LLM 歸納。

兩條路都**只產生草稿，不會直接生效**。草稿落在下面的欄位編輯器裡，人看過、
勾好必填、按儲存才寫成 yaml。沒有勾任何必填欄位會被擋下來——沒有必填欄位的話，
模型吐出來的空白列會被照單全收。

覆核完的報告上還有一顆「留作學習樣本」：把這份報告與你定案的列存成該設定檔的
新樣本，人工修正因此會回流，而不是在 job 被清掉時一起蒸發。

設定檔存在 `backend/erp/profiles/`，是客戶資料也是部署狀態，已經加進 `.gitignore`
與 `.dockerignore`，用 Docker 時請跟 `erp_jobs` 一樣掛成 volume。

### 新增供應商欄名

改對應設定檔的 `aliases` 就好（預設客戶是 `backend/erp/schema.yaml`，其餘在
`backend/erp/profiles/<id>.yaml`），存檔即生效——後端偵測 mtime 重讀，MCP server
也是即時取用，不需要重啟或重新部署。前端的設定檔編輯器做的也是同一件事。

### 相關環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `ERP_JOBS_DIR` | `backend/erp_jobs` | 暫存 job 的位置 |
| `ERP_JOBS_RETENTION_DAYS` | `14` | 超過就自動清掉（內含客戶檢驗資料） |
| `ERP_JOBS_MAX` | `2000` | job 數量上限，超過從最舊的刪 |
| `ERP_JOBS_MAX_MB` | `4096` | 暫存區容量上限，超過從最舊的刪 |
| `ERP_SOURCE_MAX_MB` | `20` | 單份原始 PDF 的大小上限 |

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
