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
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── services/api.js
│   └── package.json
├── marker/                   # Marker OCR 核心模組
└── pyproject.toml            # Marker 套件配置
```

---

## API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/` | GET | API 資訊與支援格式 |
| `/api/health` | GET | 健康檢查（含模型載入狀態） |
| `/api/upload` | POST | 單一檔案 OCR 轉換 |
| `/api/upload-batch` | POST | 批次 OCR 轉換（最多 50 檔） |
| `/api/check-quality-batch` | POST | 批次品質預檢（不執行 OCR） |
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
  "processing_time": 5.67
}
```

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
