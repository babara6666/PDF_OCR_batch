import { useState } from "react";
import ReactMarkdown from "react-markdown";

const MarkdownPreview = ({ filename, markdown, fileSize, onNewUpload }) => {
  const [viewMode, setViewMode] = useState("preview"); // 'preview' or 'raw'

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    alert("Markdown copied to clipboard!");
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(".pdf", ".md");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="w-full max-w-[1024px] flex flex-col gap-6">
      {/* Status & Title Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <span className="material-symbols-outlined text-[20px] fill-1">check_circle</span>
            <span className="text-sm font-semibold uppercase tracking-wider">
              Conversion Complete
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {filename}
          </h1>
          <p className="text-slate-500 dark:text-[#92adc9] text-sm">
            Processed successfully • {formatFileSize(fileSize)} generated
          </p>
        </div>
        {/* Action Buttons (Top) */}
        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center justify-center gap-2 rounded-lg h-10 px-5 bg-white border border-slate-200 hover:bg-slate-50 dark:bg-[#233648] dark:border-transparent dark:hover:bg-[#2f455a] text-slate-700 dark:text-white text-sm font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[20px]">content_copy</span>
            <span>Copy</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-2 rounded-lg h-10 px-5 bg-primary hover:bg-blue-600 text-white text-sm font-bold transition-all shadow-md shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            <span>Download .md</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col rounded-xl border border-slate-200 dark:border-[#233648] bg-white dark:bg-[#15202b] shadow-sm overflow-hidden flex-1 min-h-[600px]">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#233648] p-3 bg-slate-50 dark:bg-[#111a22]">
          {/* View Toggle */}
          <div className="flex h-9 items-center justify-center rounded-lg bg-slate-200 dark:bg-[#233648] p-1">
            <button
              onClick={() => setViewMode("preview")}
              className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-sm font-medium transition-all ${
                viewMode === "preview"
                  ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                  : "text-slate-500 dark:text-[#92adc9]"
              }`}
            >
              <span className="truncate">Rendered Preview</span>
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`flex cursor-pointer h-full items-center justify-center rounded px-3 text-sm font-medium transition-all ${
                viewMode === "raw"
                  ? "bg-white dark:bg-[#111a22] text-primary shadow-sm"
                  : "text-slate-500 dark:text-[#92adc9]"
              }`}
            >
              <span className="truncate">Raw Markdown</span>
            </button>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-400 dark:text-slate-500">
            <span>UTF-8</span>
            <span>Markdown</span>
          </div>
        </div>

        {/* Scrollable Preview Area */}
        <div className="flex-1 overflow-y-auto p-8 relative bg-white dark:bg-[#0d131a]">
          {viewMode === "preview" ? (
            <div className="max-w-none prose prose-slate dark:prose-invert prose-headings:font-display prose-headings:font-bold prose-a:text-primary hover:prose-a:text-blue-500">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          ) : (
            <pre className="text-sm font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {markdown}
            </pre>
          )}
        </div>
      </div>

      {/* Secondary Download Area (Footer) */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-50 dark:bg-[#111a22] border border-slate-200 dark:border-[#233648] rounded-xl p-6 gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-slate-900 dark:text-white font-semibold">Ready to use?</h3>
          <p className="text-slate-500 dark:text-[#92adc9] text-sm">
            Download the markdown file or convert another PDF.
          </p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button
            onClick={onNewUpload}
            className="flex-1 sm:flex-none flex items-center justify-center rounded-lg h-12 px-6 bg-slate-200 dark:bg-[#233648] hover:bg-slate-300 dark:hover:bg-[#2f455a] text-slate-900 dark:text-white text-base font-bold transition-all"
          >
            <span className="truncate">New Upload</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 sm:flex-none flex min-w-[160px] cursor-pointer items-center justify-center rounded-lg h-12 px-6 bg-primary hover:bg-blue-600 active:bg-blue-700 text-white text-base font-bold leading-normal tracking-wide transition-all shadow-lg shadow-primary/25"
          >
            <span className="truncate">Download .md</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default MarkdownPreview;
