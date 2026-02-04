# PDF OCR Service

基於 [datalab-to/marker](https://github.com/datalab-to/marker) 的 PDF 轉 Markdown 服務，提供 Web 前端介面上傳 PDF 並輸出 Markdown 檔案。

## 功能特色

- 🚀 **高效轉換**: 使用 Marker 深度學習模型將 PDF 轉換為 Markdown
- 🎯 **多語言支援**: 支援中英日韓等多國語言 OCR
- 📊 **表格識別**: 自動識別並格式化 PDF 中的表格
- 🔢 **數學公式**: 支援 LaTeX 數學公式提取
- 🖼️ **圖片處理**: 自動提取並保存圖片
- ⚡ **GPU 加速**: 支援 CUDA GPU 加速處理

## 系統需求

- Python 3.10+
- Node.js 18+
- CUDA GPU (建議, 可用 CPU 但較慢)
- ~3GB 磁碟空間 (模型下載)

## 專案結構

```
PDF_OCR_FS/
├── backend/           # FastAPI 後端
│   ├── main.py       # 主程式入口
│   └── requirements.txt
├── frontend/          # React 前端 (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── services/api.js
│   └── package.json
├── marker/            # Marker OCR 核心模組
└── pyproject.toml     # Marker 依賴配置
```

## 安裝

### 1. 安裝 Marker 依賴

```bash
# 使用 conda 環境
conda activate cad_ocr_dots

# 安裝 marker-pdf
pip install marker-pdf

# 或使用 uv
uv pip install marker-pdf
```

### 2. 安裝後端依賴

```bash
cd backend
uv pip install -r requirements.txt
```

### 3. 安裝前端依賴

```bash
cd frontend
npm install
```

## 啟動服務

### 啟動後端 (Port 8001)

```bash
cd backend
python main.py
```

首次啟動會自動下載 Marker 模型 (~2-3GB)，請耐心等待。

### 啟動前端 (Port 5173)

```bash
cd frontend
npm run dev
```

## 使用方式

1. 開啟瀏覽器訪問 http://localhost:5173
2. 拖放或選擇 PDF 檔案上傳
3. 等待處理完成
4. 檢視並複製/下載 Markdown 結果

## API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/` | GET | API 資訊 |
| `/api/health` | GET | 健康檢查 |
| `/api/upload` | POST | 上傳 PDF 並轉換 |

### 上傳範例

```bash
curl -X POST http://localhost:8001/api/upload \
  -F "file=@document.pdf"
```

回應格式:
```json
{
  "success": true,
  "filename": "document.pdf",
  "markdown_content": "# Title\n...",
  "file_size": 12345,
  "processing_time": 5.67
}
```

## 技術棧

- **後端**: FastAPI + Uvicorn
- **前端**: React + Vite + TailwindCSS
- **OCR 引擎**: Marker (Surya + Texify)
- **深度學習**: PyTorch (CUDA)

## 授權

- 程式碼: GPL License
- Marker 模型: AI Pubs Open Rail-M License

## 致謝

基於 [datalab-to/marker](https://github.com/datalab-to/marker) 開發
