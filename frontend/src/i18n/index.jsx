import { createContext, useContext, useState } from "react";

// ─── Translations ─────────────────────────────────────────────────────────────
export const translations = {
  en: {
    // Product
    productName:    "PrintLens",
    productSubtitle: "Inkstone Schematics",

    // Modes
    modeOcr:        "Full OCR",
    modeOcrDesc:    "Convert PDF / image files to full Markdown",
    modeNotes:      "Extract Notes",
    modeNotesDesc:  "Detect and extract the 'Notes:' section from engineering drawings",

    // Sidebar / nav
    processingNav:  "Processing…",
    reviewing:      "Review",
    batchComplete:  "Batch Complete",
    newBatch:       "New Batch",
    support:        "Support",
    checkingNav:    "Checking…",

    // Header toggle
    langToggle:     "中文",

    // Upload form
    uploadHeading:      "The Digital Inkstone",
    uploadDescOcr:      "Transform your complex PDF schematics into lightweight, structured Markdown.",
    uploadDescNotes:    "Upload engineering drawing PDFs to automatically detect and extract the 'Notes:' section. Batch processing supported.",
    dropZoneTitle:      "Rest your documents here",
    dropZoneDesc:       "Drop PDF files or click to browse",
    queueTitle:         "Preparation Queue",
    queueCount:         (n, size) => `${n} file${n > 1 ? "s" : ""} · ${size}`,
    waiting:            "Waiting",
    awaitingFragments:  "Awaiting additional fragments…",
    btnCheckQuality:    "Check Quality & Convert",
    btnCheckQualityN:   (n) => `Check Quality (${n} file${n > 1 ? "s" : ""})`,
    btnExtractNotes:    "Extract Notes",
    btnExtractNotesN:   (n) => `Extract Notes from ${n} file${n > 1 ? "s" : ""}`,
    btnProcessing:      "Processing…",
    filesNotStored:     "Files are processed locally and not stored",
    infoTitle:          "Kintsugi Repair Logic",
    infoDesc:           "Our engine identifies broken table layouts and structural gaps in your PDF, mending them with AI-driven Markdown gold. Nothing is lost, only refined.",
    engineActive:       "Engine: Active",
    batchSupported:     "Batch supported",
    e2eProcessing:      "End-to-End Processing Active",

    // Threshold settings
    thresholdSettings:   "Threshold Settings",
    thresholdSharpMin:   "Sharpness min",
    thresholdBrightMin:  "Brightness min",
    thresholdBrightMax:  "Brightness max",
    thresholdContrastMin:"Contrast min",
    thresholdReset:      "Reset to defaults",
    thresholdHint:       "Values outside range will be flagged as warnings.",

    // Quality checking loading
    checkingQualityHeading: "Checking document quality…",
    checkingQualityDesc:    (n) => `Analysing sharpness, brightness and contrast for ${n} file${n > 1 ? "s" : ""}`,

    // Quality review
    qualityReviewLabel:   "Pre-OCR Quality Review",
    qualityAllPass:       (n) => `All ${n} file${n > 1 ? "s" : ""} passed`,
    qualityPartial:       (p, n) => `${p} of ${n} passed`,
    qualityDescAllPass:   "Quality checks look good. Select which files to OCR.",
    qualityDescPartial:   "Some files have quality warnings. Select which files to proceed with OCR.",
    sharpness:            "Sharpness",
    brightness:           "Brightness",
    contrast:             "Contrast",
    tagPassed:            "PASSED",
    tagWarning:           "WARNING",
    selectAll:            "All",
    deselectAll:          "None",
    startOcr:             (n) => `Start OCR (${n} file${n > 1 ? "s" : ""})`,
    goBack:               "Go back",
    warningNote:          "OCR will run on selected files, including those with warnings.",
    noneSelected:         "Select at least one file to proceed.",

    // Processing status
    transmutingScript:    "Transmuting Script",
    processingIntroOcr:   "Converting",
    processingIntroNotes: "Extracting Notes sections from",
    filesLabel:           (n) => `${n} file${n > 1 ? "s" : ""}`,
    intoStructuredLayers: "into structured layers",
    statusLabel:          "Status",
    elapsedLabel:         "Elapsed",
    ocrExtraction:        "OCR Extraction",
    uploading:            "Uploading…",
    processingDots:       "Processing…",
    finalizing:           "Finalizing…",
    semanticAnalysis:     "Semantic Analysis",
    layerActive:          "Layer Active",
    standby:              "Standby",
    elapsedTime:          "Elapsed Time",
    keepWindowOpen:       "Files are uploaded first, then processed sequentially on the server. Please keep this window open.",

    // Batch results
    batchResultLabel:     "Batch Processing Result",
    convertedOf:          (s, t) => `${s} of ${t} converted`,
    totalTime:            (t) => `Total time: ${t}s`,
    failedCount:          (n) => `· ${n} failed`,
    downloadAll:          "Download All (.zip)",
    downloadMd:           "Download .md",
    extractionInsights:   "Extraction Insights",
    consistencyCheck:     (n) => `Consistency check across ${n} document${n > 1 ? "s" : ""}.`,
    succeededLabel:       "Succeeded",
    criticalStatus:       "Critical Status",
    noErrors:             "0 Errors",
    batchContents:        "Batch Contents",
    filesCount:           (n) => `${n} Files`,
    selectPreview:        "Select a file from the list to preview its Markdown output",
    finished:             "Finished",

    // Notes results
    extractionComplete:   "Extraction Complete",
    extractedOf:          (s, t) => `${s} of ${t} extracted`,
    noNotesText:          "No Notes text was extracted for this file.",
    detectedNotesRegion:  "Detected Notes region — orientation:",
    notesInsights:        (n) => `Notes sections detected across ${n} drawing${n > 1 ? "s" : ""}.`,
    extractedLabel:       "Extracted",
    selectPreviewNotes:   "Select a file from the list to preview its extracted Notes",
    downloadTxt:          "Download .txt",
    failedLabel:          "Failed",
  },

  zh: {
    // Product
    productName:    "藍圖析",
    productSubtitle: "圖紙智析系統",

    // Modes
    modeOcr:        "全文 OCR",
    modeOcrDesc:    "將 PDF / 圖片轉換為完整 Markdown",
    modeNotes:      "擷取備註",
    modeNotesDesc:  "自動偵測並擷取工程圖中的「Notes:」區塊",

    // Sidebar / nav
    processingNav:  "處理中…",
    reviewing:      "品質審核",
    batchComplete:  "批次完成",
    newBatch:       "新批次",
    support:        "支援",
    checkingNav:    "檢查中…",

    // Header toggle
    langToggle:     "English",

    // Upload form
    uploadHeading:      "數位石硯",
    uploadDescOcr:      "將複雜的 PDF 圖紙轉化為輕量、結構化的 Markdown，精準與優雅的轉換。",
    uploadDescNotes:    "上傳工程圖 PDF，自動偵測並擷取「Notes:」區塊，支援批次處理。",
    dropZoneTitle:      "將文件放置於此",
    dropZoneDesc:       "拖曳 PDF 或點擊瀏覽",
    queueTitle:         "待處理佇列",
    queueCount:         (n, size) => `${n} 個檔案 · ${size}`,
    waiting:            "等待中",
    awaitingFragments:  "等待上傳檔案…",
    btnCheckQuality:    "品質檢查並轉換",
    btnCheckQualityN:   (n) => `品質檢查（${n} 個檔案）`,
    btnExtractNotes:    "擷取備註",
    btnExtractNotesN:   (n) => `從 ${n} 個檔案擷取備註`,
    btnProcessing:      "處理中…",
    filesNotStored:     "檔案在本地處理，不會儲存於伺服器",
    infoTitle:          "金繼修復邏輯",
    infoDesc:           "引擎識別 PDF 中的破損表格與結構缺口，以 AI 驅動的 Markdown 金修復，一切皆被保留，只是更精緻。",
    engineActive:       "引擎：運行中",
    batchSupported:     "支援批次",
    e2eProcessing:      "端對端處理啟動中",

    // Threshold settings
    thresholdSettings:   "閾值設定",
    thresholdSharpMin:   "銳利度下限",
    thresholdBrightMin:  "亮度下限",
    thresholdBrightMax:  "亮度上限",
    thresholdContrastMin:"對比度下限",
    thresholdReset:      "恢復預設值",
    thresholdHint:       "超出範圍的數值將被標記為警告。",

    // Quality checking loading
    checkingQualityHeading: "正在檢查文件品質…",
    checkingQualityDesc:    (n) => `分析 ${n} 個檔案的銳利度、亮度與對比度`,

    // Quality review
    qualityReviewLabel:   "OCR 前品質審核",
    qualityAllPass:       (n) => `全部 ${n} 個檔案通過`,
    qualityPartial:       (p, n) => `${n} 個中有 ${p} 個通過`,
    qualityDescAllPass:   "品質檢查良好，請選擇要 OCR 的檔案。",
    qualityDescPartial:   "部分檔案有品質警告，請選擇要繼續 OCR 的檔案。",
    sharpness:            "銳利度",
    brightness:           "亮度",
    contrast:             "對比度",
    tagPassed:            "通過",
    tagWarning:           "警告",
    selectAll:            "全選",
    deselectAll:          "全不選",
    startOcr:             (n) => `開始 OCR（${n} 個檔案）`,
    goBack:               "返回",
    warningNote:          "OCR 將對所有已選取的檔案執行，包含有警告的檔案。",
    noneSelected:         "請至少選取一個檔案。",

    // Processing status
    transmutingScript:    "轉化腳本中",
    processingIntroOcr:   "正在轉換",
    processingIntroNotes: "正在從以下檔案擷取備註區塊",
    filesLabel:           (n) => `${n} 個檔案`,
    intoStructuredLayers: "為結構化層次",
    statusLabel:          "狀態",
    elapsedLabel:         "已用時間",
    ocrExtraction:        "OCR 擷取",
    uploading:            "上傳中…",
    processingDots:       "處理中…",
    finalizing:           "收尾中…",
    semanticAnalysis:     "語意分析",
    layerActive:          "層次已啟動",
    standby:              "待命",
    elapsedTime:          "已用時間",
    keepWindowOpen:       "檔案先上傳，再由伺服器依序處理。請保持此視窗開啟。",

    // Batch results
    batchResultLabel:     "批次處理結果",
    convertedOf:          (s, t) => `${t} 個中有 ${s} 個轉換完成`,
    totalTime:            (t) => `總用時：${t}s`,
    failedCount:          (n) => `· ${n} 個失敗`,
    downloadAll:          "全部下載（.zip）",
    downloadMd:           "下載 .md",
    extractionInsights:   "擷取分析",
    consistencyCheck:     (n) => `${n} 份文件的一致性檢查。`,
    succeededLabel:       "成功",
    criticalStatus:       "關鍵狀態",
    noErrors:             "0 個錯誤",
    batchContents:        "批次內容",
    filesCount:           (n) => `${n} 個檔案`,
    selectPreview:        "從列表選擇檔案以預覽 Markdown 輸出",
    finished:             "完成",

    // Notes results
    extractionComplete:   "擷取完成",
    extractedOf:          (s, t) => `${t} 個中有 ${s} 個擷取完成`,
    noNotesText:          "此檔案未擷取到 Notes 文字。",
    detectedNotesRegion:  "偵測到的 Notes 區域 — 方向：",
    notesInsights:        (n) => `${n} 份圖紙中偵測到的備註區塊。`,
    extractedLabel:       "已擷取",
    selectPreviewNotes:   "從列表選擇檔案以預覽擷取的備註",
    downloadTxt:          "下載 .txt",
    failedLabel:          "失敗",
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    return localStorage.getItem("lang") || "en";
  });

  const toggle = () => {
    const next = lang === "en" ? "zh" : "en";
    setLang(next);
    localStorage.setItem("lang", next);
  };

  return (
    <LanguageContext.Provider value={{ lang, toggle, t: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useT() {
  return useContext(LanguageContext);
}
