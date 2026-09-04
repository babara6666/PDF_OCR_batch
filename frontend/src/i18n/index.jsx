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
    modeErp:        "ERP Import",
    modeErpDesc:    "Send OCR'd inspection reports to 知識通, review the mapped rows, export for ERP",

    // ERP import mode
    erpUploadDesc:      "Turn supplier inspection reports (COA) into ERP import rows. Files are OCR'd here, then 知識通 reads the markdown and maps each supplier's column names onto the standard ERP fields.",
    btnErpStage:        "OCR & Send to 知識通",
    btnErpStageN:       (n) => `OCR & Send ${n} file${n > 1 ? "s" : ""}`,
    erpStaging:         "Staging for 知識通…",
    erpQueueHeading:    "Waiting on 知識通",
    erpQueueDesc:       (n) => `${n} report${n > 1 ? "s are" : " is"} staged. Open 知識通 and give it the instruction below — this page updates on its own as rows come back.`,
    erpReviewHeading:   "Review & Export",
    erpReviewDesc:      (n) => `${n} report${n > 1 ? "s" : ""} mapped. Check the rows against the source, correct anything wrong, then export.`,
    erpInstruction:     "Instruction for 知識通",
    erpInstructionBody: (n) => `請整理規格析裡待處理的 ${n} 份進料檢驗報告，轉成 ERP 匯入格式。`,
    erpCopy:            "Copy",
    erpCopied:          "Copied",
    erpRefresh:         "Refresh now",
    erpAuto:            "Auto-refreshing",
    erpStatusPending:   "Waiting",
    erpStatusMapped:    "Mapped",
    erpStatusFailed:    "OCR failed",
    erpRows:            (n) => `${n} row${n > 1 ? "s" : ""}`,
    erpNotesFrom:       "知識通 notes",
    erpReview:          "Review",
    erpSaveRow:         "Save changes",
    erpSaved:           "Saved",
    erpExportXlsx:      "Export .xlsx",
    erpExportCsv:       "Export .csv",
    erpExportHint:      "Reports that are not signed off are listed on a 未匯入 sheet rather than dropped.",
    erpNothingMapped:   "Nothing has been mapped yet — there is nothing to export.",
    erpViewMarkdown:    "Source markdown",
    erpDiscard:         "Discard",
    erpEmpty:           "No reports staged.",

    // Customer profiles
    erpProfile:         "Customer profile",
    erpProfileDefault:  "Default (四維)",
    erpProfileManage:   "Manage profiles",
    erpProfileBack:     "Back to upload",
    erpProfileNew:      "New profile",
    erpProfileNewName:  "Profile name (letters, digits, - and _)",
    erpProfileBuiltin:  "Built-in — edit backend/erp/schema.yaml to change it.",
    erpProfileCols:     (n) => `${n} column${n > 1 ? "s" : ""}`,
    erpProfileAliases:  (n) => `${n} alias${n > 1 ? "es" : ""}`,
    erpProfileSave:     "Save profile",
    erpProfileSaved:    "Profile saved",
    erpProfileDelete:   "Delete profile",
    erpProfileRequired: "Required",
    erpProfileAddCol:   "Add column",
    erpProfileAliasesFor: (name) => `Spellings suppliers use for 「${name}」`,
    erpProfileAliasHint: "One per line, copied exactly as the report writes it.",

    // Learning a profile
    erpLearnHeading:    "Build this profile from files you already have",
    erpLearnAliasTable: "Import an alias table (key.xlsx)",
    erpLearnAliasHelp:  "The workbook whose columns are your ERP fields and whose cells are the supplier spellings. Read straight across — no model involved.",
    erpLearnSamples:    "Learn from reports you have already done",
    erpLearnSamplesHelp:"Upload a few COA PDFs and, for each, the import workbook you filled in for it. The PDF alone says what the supplier called things; the workbook says what you decided those things were.",
    erpLearnAddSample:  "Add sample reports (PDF)",
    erpLearnAnswer:     "Answer workbook",
    erpLearnNoAnswer:   "No answer yet",
    erpLearnRows:       (n) => `${n} answer row${n > 1 ? "s" : ""}`,
    erpLearnDraft:      "Draft the profile",
    erpLearnDrafting:   "Drafting…",
    erpLearnDraftReady: "Draft ready — check every alias, then save.",
    erpLearnDraftBy:    (who) => `Drafted by ${who}`,
    erpKeepAsSample:    "Keep as a sample",
    erpKeptAsSample:    "Kept",
    erpKeepHint:        "Adds this report and the rows you settled on to the profile's learning material.",

    // Mapping engine (local / company LLM, or 知識通 by hand)
    erpEngine:          "Mapping engine",
    erpEngineOllama:    "Local model",
    erpEngineGateway:   "Company gateway",
    erpEngineManual:    "知識通 (by hand)",
    erpStartMapping:    "Start mapping",
    erpMappingN:        (n) => `Map ${n} report${n > 1 ? "s" : ""}`,
    erpMapping:         "Mapping…",
    erpMapFailed:       "Mapping failed",
    erpRetryMap:        "Retry",
    erpEngineOffline:   "Not reachable — showing the built-in model list.",
    erpEngineCaveat:    "A local model is a weaker reader than 知識通 on supplier column names it has never seen. Check every report against its source before confirming.",

    // Side-by-side review
    erpShowPdf:         "Side by side",
    erpHidePdf:         "Table only",
    erpNoSource:        "No source PDF was stored for this report — check the rows against the markdown instead.",
    erpPageOf:          (n, total) => `Page ${n} / ${total}`,
    erpZoomIn:          "Zoom in",
    erpZoomOut:         "Zoom out",
    erpPageFailed:      "This page could not be rendered.",

    // Row editing
    erpAddRow:          "Add row",
    erpDuplicateRow:    "Duplicate this row",
    erpDeleteRow:       "Delete this row",
    erpUnsaved:         "Unsaved changes",

    // Sign-off
    erpConfirm:         "Confirm",
    erpConfirmed:       "Confirmed",
    erpUnconfirm:       "Undo confirm",
    erpConfirmHint:     "Save your changes before confirming.",
    erpExportCount:     (ok, pending) =>
      pending > 0
        ? `${ok} confirmed, ${pending} still to check`
        : `${ok} confirmed`,
    erpIncludeUnreviewed: "Include unconfirmed reports",
    erpNothingReviewed: "Nothing is confirmed yet. Check each report against its source, then confirm it.",

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
    tierPaidDesc:         "For commercial use, license fees may arise under each vendor's license terms — proceed per your actual contract.",
    tierFreeDesc:         "Open-source licenses (MIT / Apache-2.0 / BSD, etc.): free to use, but you must still comply with the license terms.",
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
    modeErp:        "ERP 匯入",
    modeErpDesc:    "把辨識好的檢驗報告送給知識通，覆核對應結果後匯出給 ERP",

    // ERP 匯入模式
    erpUploadDesc:      "把供應商的進料檢驗報告（COA）轉成 ERP 匯入用的列。檔案在這裡完成辨識，接著由知識通讀 Markdown，把各家不同的欄位名稱對應到標準 ERP 欄位。",
    btnErpStage:        "辨識並送給知識通",
    btnErpStageN:       (n) => `辨識並送出 ${n} 個檔案`,
    erpStaging:         "正在送交知識通…",
    erpQueueHeading:    "等待知識通處理",
    erpQueueDesc:       (n) => `已送出 ${n} 份報告。到知識通貼上下面這句話，這個頁面會自己更新。`,
    erpReviewHeading:   "覆核與匯出",
    erpReviewDesc:      (n) => `${n} 份報告已完成對應。對照原文檢查一遍，有錯就直接改，然後匯出。`,
    erpInstruction:     "給知識通的指令",
    erpInstructionBody: (n) => `請整理規格析裡待處理的 ${n} 份進料檢驗報告，轉成 ERP 匯入格式。`,
    erpCopy:            "複製",
    erpCopied:          "已複製",
    erpRefresh:         "立即更新",
    erpAuto:            "自動更新中",
    erpStatusPending:   "等待中",
    erpStatusMapped:    "已對應",
    erpStatusFailed:    "辨識失敗",
    erpRows:            (n) => `${n} 列`,
    erpNotesFrom:       "知識通備註",
    erpReview:          "覆核",
    erpSaveRow:         "儲存修改",
    erpSaved:           "已儲存",
    erpExportXlsx:      "匯出 .xlsx",
    erpExportCsv:       "匯出 .csv",
    erpExportHint:      "沒有確認的報告不會被丟掉，會列在「未匯入」分頁。",
    erpNothingMapped:   "還沒有任何報告完成對應，沒有東西可以匯出。",
    erpViewMarkdown:    "原始 Markdown",
    erpDiscard:         "丟棄",
    erpEmpty:           "目前沒有待處理的報告。",

    // 客戶設定檔
    erpProfile:         "客戶設定檔",
    erpProfileDefault:  "預設（四維）",
    erpProfileManage:   "管理設定檔",
    erpProfileBack:     "回到上傳",
    erpProfileNew:      "新增設定檔",
    erpProfileNewName:  "設定檔名稱（英數、- 與 _）",
    erpProfileBuiltin:  "內建設定檔，要改請編輯 backend/erp/schema.yaml。",
    erpProfileCols:     (n) => `${n} 個欄位`,
    erpProfileAliases:  (n) => `${n} 種寫法`,
    erpProfileSave:     "儲存設定檔",
    erpProfileSaved:    "已儲存",
    erpProfileDelete:   "刪除設定檔",
    erpProfileRequired: "必填",
    erpProfileAddCol:   "新增欄位",
    erpProfileAliasesFor: (name) => `供應商對「${name}」的各種寫法`,
    erpProfileAliasHint: "一行一種，照報告上的原文抄，含空格與冒號。",

    // 學出設定檔
    erpLearnHeading:    "用你手上已經有的檔案建立這份設定檔",
    erpLearnAliasTable: "匯入別名對照表（key.xlsx）",
    erpLearnAliasHelp:  "就是那張「欄＝ERP 欄位、格子＝各家供應商寫法」的表。直接讀進來，不經過模型——這是抄寫，讓模型改寫只會變差。",
    erpLearnSamples:    "從已經做過的報告學",
    erpLearnSamplesHelp:"上傳幾份 COA，並且為每一份附上你們當初填好的匯入 xlsx。只有 PDF 的話，它只說得出供應商怎麼寫，說不出你們判斷那是哪一欄——附上答案才補得回那個判斷。",
    erpLearnAddSample:  "加入樣本報告（PDF）",
    erpLearnAnswer:     "對照答案",
    erpLearnNoAnswer:   "還沒有答案",
    erpLearnRows:       (n) => `答案 ${n} 列`,
    erpLearnDraft:      "產生設定檔草稿",
    erpLearnDrafting:   "產生中…",
    erpLearnDraftReady: "草稿好了——每一條別名都看過再存。",
    erpLearnDraftBy:    (who) => `由 ${who} 產生`,
    erpKeepAsSample:    "留作學習樣本",
    erpKeptAsSample:    "已留下",
    erpKeepHint:        "把這份報告與你覆核後定案的列，加進這個設定檔的學習材料。",

    // 對應引擎（本機／公司 LLM，或人工貼給知識通）
    erpEngine:          "對應引擎",
    erpEngineOllama:    "本機模型",
    erpEngineGateway:   "公司 gateway",
    erpEngineManual:    "知識通（人工貼指令）",
    erpStartMapping:    "開始對應",
    erpMappingN:        (n) => `對應 ${n} 份報告`,
    erpMapping:         "對應中…",
    erpMapFailed:       "對應失敗",
    erpRetryMap:        "重試",
    erpEngineOffline:   "連不到，先顯示內建的模型清單。",
    erpEngineCaveat:    "遇到沒看過的供應商欄名時，本機模型判斷得比知識通差。每一份都要對照原文檢查過再按確認。",

    // 並排覆核
    erpShowPdf:         "並排原文",
    erpHidePdf:         "只看表格",
    erpNoSource:        "這份沒有留下原始 PDF，請改用原始 Markdown 對照。",
    erpPageOf:          (n, total) => `第 ${n} / ${total} 頁`,
    erpZoomIn:          "放大",
    erpZoomOut:         "縮小",
    erpPageFailed:      "這一頁畫不出來。",

    // 逐列編輯
    erpAddRow:          "新增列",
    erpDuplicateRow:    "複製這一列",
    erpDeleteRow:       "刪除這一列",
    erpUnsaved:         "有未儲存的修改",

    // 人工確認
    erpConfirm:         "確認無誤",
    erpConfirmed:       "已確認",
    erpUnconfirm:       "取消確認",
    erpConfirmHint:     "請先儲存修改再確認。",
    erpExportCount:     (ok, pending) =>
      pending > 0 ? `${ok} 份已確認，${pending} 份還沒看` : `${ok} 份已確認`,
    erpIncludeUnreviewed: "連未確認的一起匯出",
    erpNothingReviewed: "還沒有確認過的報告。請逐份對照原文檢查後按「確認無誤」。",

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
    tierPaidDesc:         "於商業使用時可能依各供應商之授權條款產生授權費用，請依實際合約辦理。",
    tierFreeDesc:         "為開源授權（MIT／Apache-2.0／BSD 等），可免費使用但仍須遵守其授權條款。",
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
