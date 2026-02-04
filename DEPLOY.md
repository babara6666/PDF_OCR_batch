# 伺服器部署說明

## 端口映射

- Frontend: `18303` → `5174` (http://rd4090.fst:18303/)
- Backend: `18304` → `8001`

## 環境變數

### Backend (`.env`)
```env
HOST=0.0.0.0
PORT=8001
CORS_ORIGINS=http://rd4090.fst:18303,http://localhost:5174,http://127.0.0.1:5174
```

### Frontend (`.env`)
```env
VITE_API_BASE_URL=http://rd4090.fst:18304
```

## 部署步驟

### 1. 安裝依賴

```bash
# Backend
cd backend
uv pip install -r requirements.txt --python D:\Anaconda\envs\cad_ocr_dots\python.exe

# Frontend
cd frontend
npm install
```

### 2. 啟動服務

#### Backend (Port 8001)
```bash
cd backend
D:\Anaconda\envs\cad_ocr_dots\python.exe main.py
```

#### Frontend (Port 5174)
```bash
cd frontend
npm run dev -- --port 5174
```

### 3. 反向代理設定

需要在伺服器上設定反向代理：
- `http://rd4090.fst:18303/` → `localhost:5174` (Frontend)
- `http://rd4090.fst:18304/` → `localhost:8001` (Backend API)

## 驗證

1. 訪問 http://rd4090.fst:18303/ 應該看到上傳介面
2. 訪問 http://rd4090.fst:18304/api/health 應該返回健康狀態

## 注意事項

- 確保 `.env` 檔案已正確配置
- 確保防火牆允許 18303 和 18304 端口
- 首次啟動會下載 ~2-3GB 模型，需要良好的網路連線
