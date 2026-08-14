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

    // Dual output
    dualMode:       "Dual output",
    dualModeHint:   "For documents that already carry a text layer, run both engines and keep both results",
    engineMarker:   "Marker · layout",
    engineFastdoc:  "Text layer · verbatim",

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

    // About / licenses
    aboutOpen:            "About & licenses",
    aboutTitle:           "About & Licenses",
    aboutLink:            "About",
    close:                "Close",
    aboutIntro:           "This tool's document OCR is powered by an open-source engine. Please review its license terms before any commercial use.",
    aboutEngineTitle:     "OCR Engine",
    aboutEngineBody:      "OCR and Notes extraction are powered by Marker, developed by Datalab (Endless Labs, Inc.).",
    aboutLicenseTitle:    "License",
    aboutLicenseCode:     "Source code: GNU GPL-3.0",
    aboutLicenseModel:    "Model weights: OpenRAIL-M (modified) — includes use-based restrictions",
    aboutCommercialTitle: "Commercial-use restrictions",
    aboutCommercialIntro: "The models may NOT be used commercially if any of the following apply (personal use and research are exempt):",
    aboutCommercialRevenue:"You / your employer / affiliated entity had over US$2M gross revenue in the prior year;",
    aboutCommercialFunding:"You / your employer / affiliated entity has raised over US$2M in total equity or debt funding;",
    aboutCommercialCompete:"You provide a product or service that competes with Datalab's offerings.",
    aboutCommercialContact:"Commercial and broader-use licenses are available from Datalab at",
    aboutNoWarranty:      "Marker is distributed WITHOUT ANY WARRANTY, without even the implied warranty of merchantability or fitness for a particular purpose. See the GNU GPL-3.0 for details.",
    aboutMarkerRepo:      "Marker on GitHub",
    aboutDatalab:         "Datalab (licensing)",

    // License & fee notice page
    licenseNav:           "License & Fee Notice",
    licensePageTitle:     "Software License & Commercial-Fee Notice (Contract)",
    licenseIntro:         "This platform integrates multiple open-source components. The table below lists each major component with its version, license, and commercial-fee category. Review it before any commercial use.",
    licenseColComponent:  "Component",
    licenseColVersion:    "Version",
    licenseColLicense:    "License",
    licenseColCommercial: "Commercial fee",
    licenseColNote:       "Note",
    tierPaid:             "Commercial: paid / licensed",
    tierFree:             "Free",
    tierModel:            "Depends on model",
    tierPaidDesc:         "For commercial use, license fees may arise under each vendor's license terms — proceed per your actual contract.",
    tierFreeDesc:         "Open-source licenses (MIT / Apache-2.0 / BSD, etc.): free to use, but you must still comply with the license terms.",
    tierModelDesc:        "License and fee depend on the model weights your organization actually chooses; confirm separately.",
    licenseLegendTitle:   "Commercial-fee categories",
    licenseFootnote:      "The full license terms of each component are governed by its official LICENSE file.",
    licenseGroupFrontend: "Frontend / App libraries",
    licenseGroupBackend:  "Backend / Runtime",
    licenseGroupEngine:   "OCR / Detection engines",
    licenseGroupModel:    "AI model weights",
    licenseBack:          "Back",

    // Operation warning (system)
    opWarnTitle:          "Software Licensing Notice",
    opWarnLead:           "Before you operate this software, please note:",
    opWarnBody:           "This platform bundles open-source components, some of which require a paid license for commercial use — including Ultralytics YOLO (AGPL-3.0) and the Marker / Surya model weights (Datalab license above revenue/funding thresholds).",
    opWarnPoint1:         "Personal use, evaluation, and research are generally exempt.",
    opWarnPoint2:         "For commercial use, confirm each component's license and any fees per your actual contract.",
    opWarnPoint3:         "Full terms are governed by each component's official LICENSE file.",
    opWarnView:           "View License & Fee Notice",
    opWarnAck:            "I understand and agree",
    opWarnReopen:         "Licensing notice",
  },

  zh: {
    // Product
    productName:    "規格析",
    productSubtitle: "圖紙智析系統",

    // Modes
    modeOcr:        "全文 OCR",
    modeOcrDesc:    "將 PDF / 圖片轉換為完整 Markdown",
    modeNotes:      "擷取備註",
    modeNotesDesc:  "自動偵測並擷取工程圖中的「Notes:」區塊",

    // Dual output
    dualMode:       "雙軌輸出",
    dualModeHint:   "文件本身有文字層時，兩種引擎都跑，兩份結果都保留",
    engineMarker:   "Marker · 排版",
    engineFastdoc:  "文字層 · 原文",

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

    // About / licenses
    aboutOpen:            "關於與授權",
    aboutTitle:           "關於與授權",
    aboutLink:            "關於",
    close:                "關閉",
    aboutIntro:           "本工具的文件 OCR 由開源引擎驅動。若要用於商業用途，請務必先閱讀其授權條款。",
    aboutEngineTitle:     "OCR 引擎",
    aboutEngineBody:      "OCR 與備註擷取功能採用 Marker，由 Datalab（Endless Labs, Inc.）開發。",
    aboutLicenseTitle:    "授權",
    aboutLicenseCode:     "程式碼：GNU GPL-3.0",
    aboutLicenseModel:    "模型權重：OpenRAIL-M（改良版）— 含使用限制條款",
    aboutCommercialTitle: "商用限制",
    aboutCommercialIntro: "符合以下任一情況者，不得將模型用於商業用途（個人使用與研究用途除外）：",
    aboutCommercialRevenue:"您／您的雇主／關係企業前一年度總營收超過 200 萬美元；",
    aboutCommercialFunding:"您／您的雇主／關係企業累計募資（股權或債權）超過 200 萬美元；",
    aboutCommercialCompete:"您提供的產品或服務與 Datalab 的產品或服務構成競爭。",
    aboutCommercialContact:"商業與更廣泛用途的授權，可向 Datalab 洽詢：",
    aboutNoWarranty:      "Marker 係以「現狀」提供，不附任何明示或默示的擔保，包括適售性或特定用途適用性之默示擔保。詳見 GNU GPL-3.0。",
    aboutMarkerRepo:      "Marker GitHub",
    aboutDatalab:         "Datalab（授權洽詢）",

    // License & fee notice page
    licenseNav:           "軟體授權與收費告知",
    licensePageTitle:     "軟體授權與收費告知（合約）",
    licenseIntro:         "本平台整合多個開源元件。下表列出各主要元件之版本、授權與商用付費分類。於任何商業使用前，請詳閱本頁。",
    licenseColComponent:  "元件",
    licenseColVersion:    "版本",
    licenseColLicense:    "授權",
    licenseColCommercial: "商用付費",
    licenseColNote:       "備註",
    tierPaid:             "商用需付費／授權",
    tierFree:             "免費",
    tierModel:            "依模型而定",
    tierPaidDesc:         "於商業使用時可能依各供應商之授權條款產生授權費用，請依實際合約辦理。",
    tierFreeDesc:         "為開源授權（MIT／Apache-2.0／BSD 等），可免費使用但仍須遵守其授權條款。",
    tierModelDesc:        "其授權與費用取決於貴單位實際選用之模型權重，須另行確認。",
    licenseLegendTitle:   "商用付費分類說明",
    licenseFootnote:      "各元件之完整授權條款以其官方 LICENSE 檔為準。",
    licenseGroupFrontend: "前端／應用框架",
    licenseGroupBackend:  "後端／執行環境",
    licenseGroupEngine:   "OCR／偵測引擎",
    licenseGroupModel:    "AI 模型權重",
    licenseBack:          "返回",

    // Operation warning (system)
    opWarnTitle:          "軟體使用授權警示",
    opWarnLead:           "於操作本軟體前，請注意：",
    opWarnBody:           "本平台整合多個開源元件，其中部分元件於商業使用時需付費授權——包含 Ultralytics YOLO（AGPL-3.0）以及 Marker／Surya 之模型權重（超過營收／募資門檻時受 Datalab 授權限制）。",
    opWarnPoint1:         "個人使用、評估與研究用途通常不在收費範圍。",
    opWarnPoint2:         "商業使用時，請依實際合約確認各元件之授權與費用。",
    opWarnPoint3:         "完整條款以各元件官方 LICENSE 檔為準。",
    opWarnView:           "查看授權與收費告知（合約）",
    opWarnAck:            "我已了解並同意",
    opWarnReopen:         "授權警示",
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
