import { useState, useRef } from "react";
import { useT } from "../i18n/index.jsx";

const DEFAULT_THRESHOLDS = { minSharpness: 2.0, minBrightness: 25, maxBrightness: 245, minContrast: 15 };

const UploadForm = ({
  onFilesSelect,
  selectedFiles,
  onRemoveFile,
  onUpload,
  isProcessing,
  mode = "ocr",
  thresholds = DEFAULT_THRESHOLDS,
  onThresholdChange,
  onThresholdReset,
  defaultThresholds = DEFAULT_THRESHOLDS,
}) => {
  const { t } = useT();
  const [isDragging, setIsDragging] = useState(false);
  const [showThresholds, setShowThresholds] = useState(false);
  const fileInputRef = useRef(null);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop      = (e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) handleFilesChange(dropped);
  };

  // ── File validation ────────────────────────────────────────────────────────
  const allowedTypes = [
    "application/pdf",
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
  ];

  const isAllowedFile = (file) =>
    allowedTypes.includes(file.type) ||
    /\.(pdf|jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name);

  const getFileType = (file) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : "image";

  const handleFilesChange = (newFiles) => {
    const valid = newFiles.filter(isAllowedFile);
    const skipped = newFiles.length - valid.length;
    if (skipped > 0)
      alert(`${skipped} file(s) skipped — only PDF and image files (JPG, PNG, GIF, WEBP, BMP, TIFF) are allowed.`);
    if (valid.length > 0) onFilesSelect(valid);
  };

  const handleInputChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) handleFilesChange(files);
    e.target.value = "";
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024)        return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  return (
    <section className="flex-1 px-6 md:px-10 py-10 flex flex-col items-center">
      {/* Page heading */}
      <div className="text-center mb-10 max-w-2xl">
        <h1 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] mb-4 font-semibold tracking-tight">
          {t.uploadHeading}
        </h1>
        <p className="font-body text-on-surface-variant dark:text-[#cfc5b7] text-base leading-relaxed opacity-80 max-w-xl mx-auto">
          {mode === "notes" ? t.uploadDescNotes : t.uploadDescOcr}
        </p>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-5xl">

        {/* ── Left: Drop zone ────────────────────────────────────────────────── */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="relative group h-full min-h-[340px]">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 to-tertiary/10 dark:from-[#8D9965]/10 dark:to-[#dcc497]/10 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500 pointer-events-none" />

            <div
              className={`relative h-full flex flex-col items-center justify-center border-2 border-dashed rounded-full p-12 transition-all duration-300 cursor-pointer ${
                isDragging
                  ? "border-primary dark:border-[#dcc497] bg-primary/5 dark:bg-[#dcc497]/5"
                  : "border-outline dark:border-[#4c463c] bg-surface-container-lowest dark:bg-[#1c1b1b] hover:bg-surface-container-low dark:hover:bg-[#201f1f] hover:border-primary/50 dark:hover:border-[#dcc497]/50"
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.tif"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                type="file"
                multiple
                onChange={handleInputChange}
              />

              <div className="flex flex-col items-center gap-4 text-center pointer-events-none">
                <div className="w-24 h-24 rounded-full bg-surface-container-high dark:bg-[#2a2a2a] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform shadow-inner">
                  <span className="material-symbols-outlined text-4xl text-primary dark:text-[#dcc497]">
                    upload_file
                  </span>
                </div>
                <h3 className="font-headline text-xl text-on-background dark:text-[#e5e2e1] font-semibold">
                  {t.dropZoneTitle}
                </h3>
                <p className="font-body text-on-surface-variant dark:text-[#cfc5b7] text-sm">
                  {t.dropZoneDesc}
                </p>
                <div className="flex gap-3 mt-4">
                  <span className="px-4 py-1.5 rounded-full bg-surface-container-high dark:bg-[#2a2a2a] text-xs text-on-surface-variant dark:text-[#cfc5b7] font-medium uppercase tracking-wide">
                    MAX 50MB
                  </span>
                  <span className="px-4 py-1.5 rounded-full bg-surface-container-high dark:bg-[#2a2a2a] text-xs text-on-surface-variant dark:text-[#cfc5b7] font-medium uppercase tracking-wide">
                    PDF · IMG
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: File queue + info ────────────────────────────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* File queue card */}
          <div className="bg-surface-container-low dark:bg-[#1c1b1b] rounded-3xl p-8 flex flex-col flex-1 border border-outline-variant dark:border-[#4c463c] shadow-sm relative overflow-hidden">
            <div className="absolute top-8 right-8 opacity-5 dark:opacity-[0.03] pointer-events-none">
              <span className="material-symbols-outlined text-7xl">ink_highlighter</span>
            </div>

            <h4 className="font-headline text-lg text-primary dark:text-[#dcc497] mb-5 flex items-center gap-2 relative z-10">
              <span className="material-symbols-outlined text-[18px]">content_paste</span>
              {t.queueTitle}
              {selectedFiles.length > 0 && (
                <span className="ml-auto text-xs font-label font-medium text-on-surface-variant dark:text-[#cfc5b7]">
                  {t.queueCount(selectedFiles.length, formatFileSize(totalSize))}
                </span>
              )}
            </h4>

            {/* File list */}
            <div className="flex flex-col gap-2 flex-1 relative z-10 max-h-[260px] overflow-y-auto custom-scrollbar">
              {selectedFiles.length === 0 ? (
                <div className="flex items-center justify-center h-24 border border-dashed border-outline-variant dark:border-[#4c463c] rounded-full">
                  <p className="text-xs italic tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-40 font-label">
                    {t.awaitingFragments}
                  </p>
                </div>
              ) : (
                selectedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between p-3 px-4 bg-surface-container-lowest dark:bg-[#201f1f] rounded-full border border-outline-variant/30 dark:border-[#4c463c]/50 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 rounded border-2 border-tertiary dark:border-[#dcc497] flex items-center justify-center bg-tertiary/10 dark:bg-[#dcc497]/10">
                        <span className="material-symbols-outlined text-primary dark:text-[#dcc497] text-[14px]">
                          {getFileType(file) === "pdf" ? "article" : "image"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-on-surface dark:text-[#e5e2e1] truncate pr-2">
                          {file.name}
                        </p>
                        <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7]">
                          {formatFileSize(file.size)} · {t.waiting}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveFile(index); }}
                      className="flex-shrink-0 text-on-surface-variant dark:text-[#cfc5b7] hover:text-error dark:hover:text-[#ffb4ab] transition-colors p-1"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* CTA button */}
            <div className="mt-6 relative z-10">
              <button
                onClick={onUpload}
                disabled={isProcessing || selectedFiles.length === 0}
                className="w-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] font-headline text-base py-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-lg relative overflow-hidden group"
              >
                <span className="relative z-10 flex items-center justify-center gap-3 font-semibold">
                  <span className="material-symbols-outlined text-[20px]">brush</span>
                  {isProcessing
                    ? t.btnProcessing
                    : selectedFiles.length === 0
                    ? mode === "notes" ? t.btnExtractNotes : t.btnCheckQuality
                    : mode === "notes"
                    ? t.btnExtractNotesN(selectedFiles.length)
                    : t.btnCheckQualityN(selectedFiles.length)}
                </span>
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </button>
              <p className="text-center text-[10px] text-on-surface-variant dark:text-[#cfc5b7] uppercase tracking-[0.2em] mt-3 opacity-50 font-label">
                {t.filesNotStored}
              </p>
            </div>

            {/* Threshold settings (OCR mode only) */}
            {mode === "ocr" && (
              <div className="mt-4 relative z-10">
                <button
                  onClick={() => setShowThresholds((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-full border border-outline-variant/50 dark:border-[#4c463c]/50 text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container dark:hover:bg-[#201f1f] transition-all text-xs font-label"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[15px]">tune</span>
                    {t.thresholdSettings}
                  </span>
                  <span className="material-symbols-outlined text-[15px] transition-transform duration-200" style={{ transform: showThresholds ? "rotate(180deg)" : "none" }}>
                    expand_more
                  </span>
                </button>

                {showThresholds && (
                  <div className="mt-2 p-4 rounded-2xl border border-outline-variant/40 dark:border-[#4c463c]/40 bg-surface-container-lowest dark:bg-[#181818] space-y-4">
                    {/* Inputs */}
                    {[
                      { key: "minSharpness",  label: t.thresholdSharpMin,   min: 0,   max: 20,  step: 0.1 },
                      { key: "minBrightness", label: t.thresholdBrightMin,  min: 0,   max: 254, step: 1 },
                      { key: "maxBrightness", label: t.thresholdBrightMax,  min: 1,   max: 255, step: 1 },
                      { key: "minContrast",   label: t.thresholdContrastMin,min: 0,   max: 127, step: 1 },
                    ].map(({ key, label, min, max, step }) => {
                      const value = thresholds[key];
                      const isModified = value !== defaultThresholds[key];
                      return (
                        <div key={key}>
                          <div className="flex justify-between items-baseline mb-1.5">
                            <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7]">
                              {label}
                            </label>
                            <div className="flex items-center gap-1.5">
                              {isModified && (
                                <span className="text-[9px] font-label text-tertiary dark:text-[#dcc497] uppercase tracking-wide">
                                  {defaultThresholds[key]}→
                                </span>
                              )}
                              <input
                                type="number"
                                value={value}
                                min={min}
                                max={max}
                                step={step}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (!isNaN(v)) onThresholdChange(key, v);
                                }}
                                className="w-16 text-right text-xs font-mono font-bold bg-transparent border-b border-outline-variant dark:border-[#4c463c] text-on-surface dark:text-[#e5e2e1] focus:outline-none focus:border-primary dark:focus:border-[#dcc497] transition-colors pb-0.5"
                              />
                            </div>
                          </div>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={value}
                            onChange={(e) => onThresholdChange(key, parseFloat(e.target.value))}
                            className="w-full h-1 accent-primary dark:accent-[#dcc497] cursor-pointer"
                          />
                        </div>
                      );
                    })}

                    {/* Hint + reset */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[9px] text-on-surface-variant dark:text-[#cfc5b7] opacity-50 font-body leading-snug max-w-[60%]">
                        {t.thresholdHint}
                      </p>
                      <button
                        onClick={onThresholdReset}
                        className="text-[10px] font-label font-semibold text-primary dark:text-[#dcc497] hover:opacity-70 transition-opacity"
                      >
                        {t.thresholdReset}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Status row */}
      <div className="mt-12 w-full max-w-5xl flex flex-wrap items-center gap-6 border-t border-tertiary/20 dark:border-[#dcc497]/20 pt-6 text-on-surface-variant dark:text-[#cfc5b7]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary dark:bg-[#dcc497] animate-pulse" />
          <span className="text-xs font-label">{t.engineActive}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">speed</span>
          <span className="text-xs font-label">{t.batchSupported}</span>
        </div>
      </div>
    </section>
  );
};

export default UploadForm;
