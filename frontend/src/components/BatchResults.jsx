import { useState } from "react";
import ReactMarkdown from "react-markdown";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useT } from "../i18n/index.jsx";

const BatchResults = ({ results, onNewUpload }) => {
  const { t } = useT();
  const succeeded = results.filter((r) => r.success);
  const failed    = results.filter((r) => !r.success);
  const totalTime = results.reduce((s, r) => s + (r.processing_time || 0), 0);

  const [selectedIdx, setSelectedIdx] = useState(results.findIndex((r) => r.success));
  const [viewMode, setViewMode] = useState("preview");

  const current = results[selectedIdx] ?? null;

  const handleCopy = (md) => navigator.clipboard.writeText(md);

  const handleDownloadSingle = (result) => {
    const blob = new Blob([result.markdown_content], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = result.filename.replace(/\.[^.]+$/, ".md");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    succeeded.forEach((r) => {
      zip.file(r.filename.replace(/\.[^.]+$/, ".md"), r.markdown_content);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "ocr_results.zip");
  };

  const formatFileSize = (bytes) => {
    if (!bytes)              return "—";
    if (bytes < 1024)        return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <section className="flex-1 px-6 md:px-10 py-10">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div className="space-y-1">
          <span className="text-primary dark:text-[#dcc497] font-label font-bold tracking-[0.2em] text-xs uppercase">
            {t.batchResultLabel}
          </span>
          <h2 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter leading-tight">
            {t.convertedOf(succeeded.length, results.length)}
          </h2>
          <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body">
            {t.totalTime(totalTime.toFixed(1))}
            {failed.length > 0 && (
              <span className="text-error dark:text-[#ffb4ab] ml-2">{t.failedCount(failed.length)}</span>
            )}
          </p>
        </div>
        <div className="flex gap-3 items-center">
          {succeeded.length > 1 && (
            <button
              onClick={handleDownloadAll}
              className="flex items-center gap-2 rounded-full h-10 px-5 bg-primary dark:bg-[#dcc497] hover:opacity-90 text-on-primary dark:text-[#3d2e0e] text-sm font-bold transition-all shadow-md"
            >
              <span className="material-symbols-outlined text-[18px]">folder_zip</span>
              {t.downloadAll}
            </button>
          )}
          <button
            onClick={onNewUpload}
            className="flex items-center gap-2 rounded-full h-10 px-5 bg-surface-container-high dark:bg-[#2a2a2a] hover:bg-surface-container-highest dark:hover:bg-[#353534] text-on-surface dark:text-[#e5e2e1] text-sm font-bold transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t.newBatch}
          </button>
        </div>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-12 gap-5">

        {/* ── Main preview card ─────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-8 bg-surface-container-low dark:bg-[#1c1b1b] rounded-3xl overflow-hidden flex flex-col border border-outline-variant dark:border-[#4c463c] shadow-xl min-h-[520px]">
          {current && current.success ? (
            <>
              {/* Toolbar */}
              <div className="p-5 border-b border-outline-variant/30 dark:border-[#4c463c]/50 flex justify-between items-center bg-surface-container/30 dark:bg-[#201f1f]/50">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary dark:text-[#dcc497]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    code
                  </span>
                  <span className="font-headline font-bold text-on-surface dark:text-[#e5e2e1] text-sm truncate max-w-[200px]">
                    {current.filename.replace(/\.[^.]+$/, ".md")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 items-center rounded-full bg-surface-container-high dark:bg-[#2a2a2a] p-0.5">
                    {["preview", "raw"].map((v) => (
                      <button
                        key={v}
                        onClick={() => setViewMode(v)}
                        className={`h-full px-3 rounded-full text-xs font-label font-medium transition-all ${
                          viewMode === v
                            ? "bg-surface dark:bg-[#131313] text-primary dark:text-[#dcc497] shadow-sm"
                            : "text-on-surface-variant dark:text-[#cfc5b7]"
                        }`}
                      >
                        {v === "preview" ? "Preview" : "Raw"}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleCopy(current.markdown_content)}
                    className="p-2 hover:bg-surface-container-highest dark:hover:bg-[#353534] rounded-full transition-all text-on-surface-variant dark:text-[#cfc5b7]"
                    title="Copy to clipboard"
                  >
                    <span className="material-symbols-outlined text-[20px]">content_copy</span>
                  </button>
                  <button
                    onClick={() => handleDownloadSingle(current)}
                    className="p-2 hover:bg-surface-container-highest dark:hover:bg-[#353534] rounded-full transition-all text-on-surface-variant dark:text-[#cfc5b7]"
                    title="Download .md"
                  >
                    <span className="material-symbols-outlined text-[20px]">download</span>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 md:p-10 bg-surface-container-lowest dark:bg-[#0e0e0e]/50 custom-scrollbar">
                {viewMode === "preview" ? (
                  <div className="font-headline leading-relaxed text-on-surface-variant dark:text-[#cfc5b7] space-y-4 prose prose-sm max-w-none dark:prose-invert prose-headings:font-headline prose-headings:text-on-surface dark:prose-headings:text-[#e5e2e1] prose-a:text-primary dark:prose-a:text-[#dcc497]">
                    <ReactMarkdown>{current.markdown_content}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="text-sm font-mono text-on-surface dark:text-[#e5e2e1] whitespace-pre-wrap leading-relaxed">
                    {current.markdown_content}
                  </pre>
                )}
              </div>

              {/* Quality metadata */}
              {current.blur_score > 0 && (
                <div className="px-6 py-3 border-t border-outline-variant/20 dark:border-[#4c463c]/30 flex gap-3 bg-surface-container/20 dark:bg-[#201f1f]/30">
                  {[
                    { icon: "blur_on",    label: t.sharpness,   val: current.blur_score?.toFixed(2) },
                    { icon: "light_mode", label: t.brightness,  val: current.brightness?.toFixed(0) },
                    { icon: "contrast",   label: t.contrast,    val: current.contrast?.toFixed(0) },
                  ].map(({ icon, label, val }) => (
                    <span key={label} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-high dark:bg-[#2a2a2a] text-xs text-on-surface-variant dark:text-[#cfc5b7]">
                      <span className="material-symbols-outlined text-[12px]">{icon}</span>
                      {label} {val}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant dark:text-[#cfc5b7] opacity-30 mb-4">description</span>
              <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body opacity-50">
                {t.selectPreview}
              </p>
            </div>
          )}
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-5">

          {/* Statistics card */}
          <div className="glass-panel rounded-3xl p-7 flex flex-col justify-between border border-tertiary/20 dark:border-[#dcc497]/15 shadow-lg min-h-[160px]">
            <div>
              <div className="w-11 h-11 bg-primary/10 dark:bg-[#dcc497]/10 rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary dark:text-[#dcc497]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  analytics
                </span>
              </div>
              <h3 className="font-headline text-xl font-bold text-on-surface dark:text-[#e5e2e1]">{t.extractionInsights}</h3>
              <p className="text-on-surface-variant dark:text-[#cfc5b7] text-xs mt-1 font-body">
                {t.consistencyCheck(results.length)}
              </p>
            </div>
            <div className="flex justify-between items-end mt-4">
              <div>
                <span className="text-3xl font-headline font-black text-tertiary dark:text-[#dcc497]">
                  {succeeded.length}
                </span>
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] font-bold mt-0.5">
                  {t.succeededLabel}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-headline font-bold text-primary dark:text-[#8D9965]">
                  {failed.length === 0 ? t.noErrors : `${failed.length} Failed`}
                </span>
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] font-bold mt-0.5">
                  {t.criticalStatus}
                </p>
              </div>
            </div>
          </div>

          {/* Files list card */}
          <div className="bg-surface-container-low dark:bg-[#1c1b1b] rounded-3xl p-6 border border-outline-variant dark:border-[#4c463c] shadow-md flex-1">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-headline text-lg font-bold text-on-surface dark:text-[#e5e2e1]">{t.batchContents}</h3>
              <span className="text-xs text-primary dark:text-[#dcc497] font-bold font-label">{t.filesCount(results.length)}</span>
            </div>

            <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto custom-scrollbar">
              {results.map((result, index) => {
                const isViewing = index === selectedIdx;
                return (
                  <button
                    key={`${result.filename}-${index}`}
                    onClick={() => result.success && setSelectedIdx(index)}
                    className={`group flex items-center justify-between p-3 rounded-full transition-all duration-200 text-left ${
                      isViewing
                        ? "bg-primary/10 dark:bg-[#dcc497]/10 border border-primary/20 dark:border-[#dcc497]/20"
                        : result.success
                        ? "hover:bg-surface-container dark:hover:bg-[#201f1f] cursor-pointer"
                        : "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                        isViewing
                          ? "bg-primary/20 dark:bg-[#dcc497]/20"
                          : "bg-surface-container-highest dark:bg-[#353534] group-hover:bg-primary/10 dark:group-hover:bg-[#dcc497]/10"
                      }`}>
                        <span className={`material-symbols-outlined text-[18px] transition-colors ${
                          isViewing
                            ? "text-primary dark:text-[#dcc497]"
                            : "text-on-surface-variant dark:text-[#cfc5b7] group-hover:text-primary dark:group-hover:text-[#dcc497]"
                        }`}>
                          insert_drive_file
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-bold truncate max-w-[130px] ${
                          isViewing ? "text-primary dark:text-[#dcc497]" : "text-on-surface dark:text-[#e5e2e1]"
                        }`}>
                          {result.filename}
                        </p>
                        <p className="text-[10px] text-on-surface-variant dark:text-[#cfc5b7] uppercase font-medium">
                          {formatFileSize(result.file_size)} · {result.success ? t.finished : t.failedLabel}
                        </p>
                      </div>
                    </div>
                    {result.success ? (
                      isViewing ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary dark:bg-[#dcc497] animate-pulse flex-shrink-0" />
                      ) : (
                        <span className="material-symbols-outlined text-tertiary dark:text-[#dcc497]/70 text-sm flex-shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                          check_circle
                        </span>
                      )
                    ) : (
                      <span className="material-symbols-outlined text-error dark:text-[#ffb4ab] text-sm flex-shrink-0">
                        error
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Download action */}
          <div className="flex flex-col gap-2">
            {succeeded.length === 1 && (
              <button
                onClick={() => handleDownloadSingle(succeeded[0])}
                className="flex items-center justify-center gap-2 bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] px-6 py-3 rounded-full text-sm font-bold shadow-sm hover:opacity-90 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                {t.downloadMd}
              </button>
            )}
            {succeeded.length > 1 && (
              <button
                onClick={handleDownloadAll}
                className="flex items-center justify-center gap-2 bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] px-6 py-3 rounded-full text-sm font-bold shadow-sm hover:opacity-90 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">folder_zip</span>
                {t.downloadAll}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BatchResults;
