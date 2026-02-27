import { useState } from "react";
import ReactMarkdown from "react-markdown";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const BatchResults = ({ results, onNewUpload }) => {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [viewModes, setViewModes] = useState({});

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalTime = results.reduce((s, r) => s + (r.processing_time || 0), 0);

  const getViewMode = (idx) => viewModes[idx] || "preview";
  const toggleViewMode = (idx) => {
    setViewModes((prev) => ({
      ...prev,
      [idx]: prev[idx] === "raw" ? "preview" : "raw",
    }));
  };

  const handleCopy = (markdown) => {
    navigator.clipboard.writeText(markdown);
  };

  const handleDownloadSingle = (result) => {
    const blob = new Blob([result.markdown_content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename.replace(/\.[^.]+$/, ".md");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    succeeded.forEach((r) => {
      const mdName = r.filename.replace(/\.[^.]+$/, ".md");
      zip.file(mdName, r.markdown_content);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "ocr_results.zip");
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (result) => {
    if (result.file_type === "pdf") return "picture_as_pdf";
    return "image";
  };

  return (
    <div className="w-full max-w-[1024px] flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <span className="material-symbols-outlined text-[20px] fill-1">
              check_circle
            </span>
            <span className="text-sm font-semibold uppercase tracking-wider">
              Batch Complete
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {succeeded.length} of {results.length} files converted
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
        <div className="flex gap-3">
          {succeeded.length > 1 && (
            <button
              onClick={handleDownloadAll}
              className="flex items-center justify-center gap-2 rounded-lg h-10 px-5 bg-primary hover:bg-blue-600 text-white text-sm font-bold transition-all shadow-md shadow-primary/20"
            >
              <span className="material-symbols-outlined text-[20px]">
                folder_zip
              </span>
              <span>Download All (.zip)</span>
            </button>
          )}
        </div>
      </div>

      {/* Results List */}
      <div className="flex flex-col gap-3">
        {results.map((result, index) => {
          const isExpanded = expandedIndex === index;
          return (
            <div
              key={`${result.filename}-${index}`}
              className="rounded-xl border border-slate-200 dark:border-[#233648] bg-white dark:bg-[#15202b] shadow-sm overflow-hidden"
            >
              {/* File Row */}
              <button
                onClick={() =>
                  setExpandedIndex(isExpanded ? null : index)
                }
                className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-[#192633] transition-colors text-left"
              >
                {/* Status Icon */}
                <div
                  className={`flex-shrink-0 size-10 rounded-lg flex items-center justify-center ${
                    result.success
                      ? "bg-green-50 dark:bg-green-500/10 text-green-500"
                      : "bg-red-50 dark:bg-red-500/10 text-red-500"
                  }`}
                >
                  <span className="material-symbols-outlined text-xl">
                    {result.success ? "check_circle" : "error"}
                  </span>
                </div>

                {/* File Info */}
                <div className="flex flex-col flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">
                    {result.filename}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-[#92adc9]">
                    {result.success ? (
                      <>
                        <span>{formatFileSize(result.file_size)}</span>
                        <span>·</span>
                        <span>{result.processing_time?.toFixed(1)}s</span>
                      </>
                    ) : (
                      <span className="text-red-500">{result.error}</span>
                    )}
                  </div>
                </div>

                {/* Expand Icon */}
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

              {/* Expanded Content */}
              {isExpanded && result.success && (
                <div className="border-t border-slate-200 dark:border-[#233648]">
                  {/* Toolbar */}
                  <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#111a22]">
                    {/* View Toggle */}
                    <div className="flex h-8 items-center justify-center rounded-lg bg-slate-200 dark:bg-[#233648] p-1">
                      <button
                        onClick={() =>
                          getViewMode(index) !== "preview" &&
                          toggleViewMode(index)
                        }
                        className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-xs font-medium transition-all ${
                          getViewMode(index) === "preview"
                            ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                            : "text-slate-500 dark:text-[#92adc9]"
                        }`}
                      >
                        Preview
                      </button>
                      <button
                        onClick={() =>
                          getViewMode(index) !== "raw" &&
                          toggleViewMode(index)
                        }
                        className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-xs font-medium transition-all ${
                          getViewMode(index) === "raw"
                            ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                            : "text-slate-500 dark:text-[#92adc9]"
                        }`}
                      >
                        Raw
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCopy(result.markdown_content)}
                        className="flex items-center gap-1.5 rounded-lg h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 dark:bg-[#233648] dark:border-transparent dark:hover:bg-[#2f455a] text-slate-700 dark:text-white text-xs font-bold transition-all"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          content_copy
                        </span>
                        Copy
                      </button>
                      <button
                        onClick={() => handleDownloadSingle(result)}
                        className="flex items-center gap-1.5 rounded-lg h-8 px-3 bg-primary hover:bg-blue-600 text-white text-xs font-bold transition-all"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          download
                        </span>
                        .md
                      </button>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="max-h-[500px] overflow-y-auto p-6 bg-white dark:bg-[#0d131a]">
                    {getViewMode(index) === "preview" ? (
                      <div className="max-w-none prose prose-sm prose-slate dark:prose-invert prose-headings:font-display prose-headings:font-bold prose-a:text-primary hover:prose-a:text-blue-500">
                        <ReactMarkdown>
                          {result.markdown_content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="text-sm font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                        {result.markdown_content}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-50 dark:bg-[#111a22] border border-slate-200 dark:border-[#233648] rounded-xl p-6 gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-slate-900 dark:text-white font-semibold">
            Done!
          </h3>
          <p className="text-slate-500 dark:text-[#92adc9] text-sm">
            Download the results or process another batch.
          </p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button
            onClick={onNewUpload}
            className="flex-1 sm:flex-none flex items-center justify-center rounded-lg h-12 px-6 bg-slate-200 dark:bg-[#233648] hover:bg-slate-300 dark:hover:bg-[#2f455a] text-slate-900 dark:text-white text-base font-bold transition-all"
          >
            New Batch
          </button>
          {succeeded.length > 1 && (
            <button
              onClick={handleDownloadAll}
              className="flex-1 sm:flex-none flex min-w-[160px] cursor-pointer items-center justify-center rounded-lg h-12 px-6 bg-primary hover:bg-blue-600 active:bg-blue-700 text-white text-base font-bold leading-normal tracking-wide transition-all shadow-lg shadow-primary/25"
            >
              Download All (.zip)
            </button>
          )}
          {succeeded.length === 1 && (
            <button
              onClick={() => handleDownloadSingle(succeeded[0])}
              className="flex-1 sm:flex-none flex min-w-[160px] cursor-pointer items-center justify-center rounded-lg h-12 px-6 bg-primary hover:bg-blue-600 active:bg-blue-700 text-white text-base font-bold leading-normal tracking-wide transition-all shadow-lg shadow-primary/25"
            >
              Download .md
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchResults;
