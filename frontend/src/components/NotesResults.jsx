import { useState } from "react";

/**
 * Displays the results of a Notes-section extraction batch.
 *
 * Each result card shows:
 *   - Success / failure status
 *   - Extracted Notes text (with copy button)
 *   - Cropped image of the detected Notes region (if available)
 */
const NotesResults = ({ results, onNewUpload }) => {
  const [expandedIndex, setExpandedIndex] = useState(null);
  // "text" | "image" per card
  const [viewModes, setViewModes] = useState({});

  const succeeded = results.filter((r) => r.success);
  const failed    = results.filter((r) => !r.success);
  const totalTime = results.reduce((s, r) => s + (r.processing_time || 0), 0);

  const getViewMode = (idx) => viewModes[idx] || "text";
  const setViewMode = (idx, mode) =>
    setViewModes((prev) => ({ ...prev, [idx]: mode }));

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text || "");
  };

  const handleDownloadText = (result) => {
    const blob = new Blob([result.notes_text || ""], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = result.filename.replace(/\.[^.]+$/, "_notes.txt");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadImage = (result) => {
    if (!result.crop_image_b64) return;
    const a       = document.createElement("a");
    a.href        = `data:image/png;base64,${result.crop_image_b64}`;
    a.download    = result.filename.replace(/\.[^.]+$/, "_notes_crop.png");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "—";
    if (bytes < 1024)       return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="w-full max-w-[1024px] flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <span className="material-symbols-outlined text-[20px] fill-1">
              check_circle
            </span>
            <span className="text-sm font-semibold uppercase tracking-wider">
              Extraction Complete
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {succeeded.length} of {results.length} files extracted
          </h1>
          <p className="text-slate-500 dark:text-[#92adc9] text-sm">
            Total processing time: {totalTime.toFixed(1)}s
            {failed.length > 0 && (
              <span className="text-red-500 ml-2">
                · {failed.length} failed
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Results list ── */}
      <div className="flex flex-col gap-3">
        {results.map((result, index) => {
          const isExpanded = expandedIndex === index;
          const viewMode   = getViewMode(index);
          const hasImage   = !!result.crop_image_b64;

          return (
            <div
              key={`${result.filename}-${index}`}
              className="rounded-xl border border-slate-200 dark:border-[#233648] bg-white dark:bg-[#15202b] shadow-sm overflow-hidden"
            >
              {/* File row */}
              <button
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-[#192633] transition-colors text-left"
              >
                {/* Status icon */}
                <div
                  className={`flex-shrink-0 size-10 rounded-lg flex items-center justify-center ${
                    result.success
                      ? "bg-green-50 dark:bg-green-500/10 text-green-500"
                      : "bg-red-50 dark:bg-red-500/10 text-red-500"
                  }`}
                >
                  <span className="material-symbols-outlined text-xl">
                    {result.success ? "sticky_note_2" : "error"}
                  </span>
                </div>

                {/* File info */}
                <div className="flex flex-col flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{result.filename}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-[#92adc9]">
                    {result.success ? (
                      <>
                        <span>{formatFileSize(result.file_size)}</span>
                        <span>·</span>
                        <span>{result.processing_time?.toFixed(1)}s</span>
                        {result.orientation && (
                          <>
                            <span>·</span>
                            <span className={result.orientation === "landscape" ? "text-violet-500" : "text-amber-500"}>
                              {result.orientation}
                            </span>
                          </>
                        )}
                        {hasImage && (
                          <>
                            <span>·</span>
                            <span className="text-blue-500">crop available</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-red-500">{result.error}</span>
                    )}
                  </div>
                </div>

                {/* Expand chevron */}
                {result.success && (
                  <span
                    className={`material-symbols-outlined text-xl text-slate-400 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  >
                    expand_more
                  </span>
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && result.success && (
                <div className="border-t border-slate-200 dark:border-[#233648]">

                  {/* Toolbar */}
                  <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#111a22]">

                    {/* Tab selector */}
                    <div className="flex h-8 items-center justify-center rounded-lg bg-slate-200 dark:bg-[#233648] p-1">
                      <button
                        onClick={() => setViewMode(index, "text")}
                        className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-xs font-medium transition-all ${
                          viewMode === "text"
                            ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                            : "text-slate-500 dark:text-[#92adc9]"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px] mr-1">
                          article
                        </span>
                        Notes Text
                      </button>
                      {hasImage && (
                        <button
                          onClick={() => setViewMode(index, "image")}
                          className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-xs font-medium transition-all ${
                            viewMode === "image"
                              ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                              : "text-slate-500 dark:text-[#92adc9]"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px] mr-1">
                            crop
                          </span>
                          Crop Preview
                        </button>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {viewMode === "text" && (
                        <>
                          <button
                            onClick={() => handleCopyText(result.notes_text)}
                            className="flex items-center gap-1.5 rounded-lg h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 dark:bg-[#233648] dark:border-transparent dark:hover:bg-[#2f455a] text-slate-700 dark:text-white text-xs font-bold transition-all"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              content_copy
                            </span>
                            Copy
                          </button>
                          <button
                            onClick={() => handleDownloadText(result)}
                            className="flex items-center gap-1.5 rounded-lg h-8 px-3 bg-primary hover:bg-blue-600 text-white text-xs font-bold transition-all"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              download
                            </span>
                            .txt
                          </button>
                        </>
                      )}
                      {viewMode === "image" && hasImage && (
                        <button
                          onClick={() => handleDownloadImage(result)}
                          className="flex items-center gap-1.5 rounded-lg h-8 px-3 bg-primary hover:bg-blue-600 text-white text-xs font-bold transition-all"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            download
                          </span>
                          .png
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Content area */}
                  <div className="p-6 bg-white dark:bg-[#0d131a]">
                    {viewMode === "text" && (
                      <div className="max-h-[400px] overflow-y-auto">
                        {result.notes_text ? (
                          <pre className="text-sm font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                            {result.notes_text}
                          </pre>
                        ) : (
                          <p className="text-sm text-slate-400 italic">
                            No Notes text was extracted.
                          </p>
                        )}
                      </div>
                    )}

                    {viewMode === "image" && hasImage && (
                      <div className="flex flex-col items-start gap-3">
                        <p className="text-xs text-slate-500 dark:text-[#92adc9]">
                          Detected Notes region — orientation:{" "}
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {result.orientation ?? "unknown"}
                          </span>
                        </p>
                        <img
                          src={`data:image/png;base64,${result.crop_image_b64}`}
                          alt="Notes region crop"
                          className="max-w-full border border-slate-200 dark:border-[#233648] rounded-lg shadow-sm"
                          style={{ imageRendering: "crisp-edges" }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-50 dark:bg-[#111a22] border border-slate-200 dark:border-[#233648] rounded-xl p-6 gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-slate-900 dark:text-white font-semibold">Done!</h3>
          <p className="text-slate-500 dark:text-[#92adc9] text-sm">
            Extract Notes from another batch or switch to Full OCR mode.
          </p>
        </div>
        <button
          onClick={onNewUpload}
          className="flex items-center justify-center rounded-lg h-12 px-6 bg-slate-200 dark:bg-[#233648] hover:bg-slate-300 dark:hover:bg-[#2f455a] text-slate-900 dark:text-white text-base font-bold transition-all"
        >
          New Batch
        </button>
      </div>
    </div>
  );
};

export default NotesResults;
