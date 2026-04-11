import { useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useT } from "../i18n/index.jsx";

const NotesResults = ({ results, onNewUpload }) => {
  const { t } = useT();
  const succeeded = results.filter((r) => r.success);
  const failed    = results.filter((r) => !r.success);
  const totalTime = results.reduce((s, r) => s + (r.processing_time || 0), 0);

  const [selectedIdx, setSelectedIdx] = useState(results.findIndex((r) => r.success));
  const [viewMode, setViewMode] = useState("text");

  const current  = results[selectedIdx] ?? null;
  const hasImage = !!current?.crop_image_b64;

  const handleCopyText = (text) => navigator.clipboard.writeText(text || "");

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
    const a    = document.createElement("a");
    a.href     = `data:image/png;base64,${result.crop_image_b64}`;
    a.download = result.filename.replace(/\.[^.]+$/, "_notes_crop.png");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const b64ToUint8Array = (b64) => {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    succeeded.forEach((r) => {
      const base = r.filename.replace(/\.[^.]+$/, "");
      zip.file(`${base}_notes.txt`, r.notes_text || "");
      if (r.crop_image_b64)
        zip.file(`${base}_notes_crop.png`, b64ToUint8Array(r.crop_image_b64));
    });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "notes_results.zip");
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
            {t.extractionComplete}
          </span>
          <h2 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter leading-tight">
            {t.extractedOf(succeeded.length, results.length)}
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
        <div className="col-span-12 lg:col-span-8 bg-surface-container-low dark:bg-[#1c1b1b] rounded-3xl overflow-hidden flex flex-col border border-outline-variant dark:border-[#4c463c] shadow-xl min-h-[480px]">
          {current && current.success ? (
            <>
              {/* Toolbar */}
              <div className="p-5 border-b border-outline-variant/30 dark:border-[#4c463c]/50 flex justify-between items-center bg-surface-container/30 dark:bg-[#201f1f]/50">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary dark:text-[#dcc497]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    sticky_note_2
                  </span>
                  <span className="font-headline font-bold text-on-surface dark:text-[#e5e2e1] text-sm truncate max-w-[200px]">
                    {current.filename.replace(/\.[^.]+$/, "_notes")}
                  </span>
                  {current.orientation && (
                    <span className={`text-[10px] font-label font-bold uppercase px-2 py-0.5 rounded-full ${
                      current.orientation === "landscape"
                        ? "bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400"
                        : "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                    }`}>
                      {current.orientation}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 items-center rounded-full bg-surface-container-high dark:bg-[#2a2a2a] p-0.5">
                    <button
                      onClick={() => setViewMode("text")}
                      className={`h-full px-3 rounded-full text-xs font-label font-medium transition-all flex items-center gap-1 ${
                        viewMode === "text"
                          ? "bg-surface dark:bg-[#131313] text-primary dark:text-[#dcc497] shadow-sm"
                          : "text-on-surface-variant dark:text-[#cfc5b7]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]">article</span>
                      Text
                    </button>
                    {hasImage && (
                      <button
                        onClick={() => setViewMode("image")}
                        className={`h-full px-3 rounded-full text-xs font-label font-medium transition-all flex items-center gap-1 ${
                          viewMode === "image"
                            ? "bg-surface dark:bg-[#131313] text-primary dark:text-[#dcc497] shadow-sm"
                            : "text-on-surface-variant dark:text-[#cfc5b7]"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[12px]">crop</span>
                        Crop
                      </button>
                    )}
                  </div>
                  {viewMode === "text" && (
                    <>
                      <button
                        onClick={() => handleCopyText(current.notes_text)}
                        className="p-2 hover:bg-surface-container-highest dark:hover:bg-[#353534] rounded-full transition-all text-on-surface-variant dark:text-[#cfc5b7]"
                        title="Copy"
                      >
                        <span className="material-symbols-outlined text-[20px]">content_copy</span>
                      </button>
                      <button
                        onClick={() => handleDownloadText(current)}
                        className="p-2 hover:bg-surface-container-highest dark:hover:bg-[#353534] rounded-full transition-all text-on-surface-variant dark:text-[#cfc5b7]"
                        title="Download .txt"
                      >
                        <span className="material-symbols-outlined text-[20px]">download</span>
                      </button>
                    </>
                  )}
                  {viewMode === "image" && hasImage && (
                    <button
                      onClick={() => handleDownloadImage(current)}
                      className="p-2 hover:bg-surface-container-highest dark:hover:bg-[#353534] rounded-full transition-all text-on-surface-variant dark:text-[#cfc5b7]"
                      title="Download crop .png"
                    >
                      <span className="material-symbols-outlined text-[20px]">download</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 md:p-10 bg-surface-container-lowest dark:bg-[#0e0e0e]/50 custom-scrollbar">
                {viewMode === "text" && (
                  current.notes_text ? (
                    <pre className="text-sm font-mono text-on-surface dark:text-[#e5e2e1] whitespace-pre-wrap leading-relaxed">
                      {current.notes_text}
                    </pre>
                  ) : (
                    <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] italic font-body">
                      {t.noNotesText}
                    </p>
                  )
                )}
                {viewMode === "image" && hasImage && (
                  <div className="flex flex-col items-start gap-4">
                    <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] font-body">
                      {t.detectedNotesRegion}{" "}
                      <span className="font-semibold text-on-surface dark:text-[#e5e2e1]">
                        {current.orientation ?? "unknown"}
                      </span>
                    </p>
                    <img
                      src={`data:image/png;base64,${current.crop_image_b64}`}
                      alt="Notes region crop"
                      className="max-w-full border border-outline-variant dark:border-[#4c463c] rounded-2xl shadow-sm"
                      style={{ imageRendering: "crisp-edges" }}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <span className="material-symbols-outlined text-5xl text-on-surface-variant dark:text-[#cfc5b7] opacity-30 mb-4">
                sticky_note_2
              </span>
              <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body opacity-50">
                {t.selectPreviewNotes}
              </p>
            </div>
          )}
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-5">

          {/* Stats card */}
          <div className="glass-panel rounded-3xl p-7 flex flex-col justify-between border border-tertiary/20 dark:border-[#dcc497]/15 shadow-lg min-h-[160px]">
            <div>
              <div className="w-11 h-11 bg-primary/10 dark:bg-[#dcc497]/10 rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary dark:text-[#dcc497]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  analytics
                </span>
              </div>
              <h3 className="font-headline text-xl font-bold text-on-surface dark:text-[#e5e2e1]">{t.extractionInsights}</h3>
              <p className="text-on-surface-variant dark:text-[#cfc5b7] text-xs mt-1 font-body">
                {t.notesInsights(results.length)}
              </p>
            </div>
            <div className="flex justify-between items-end mt-4">
              <div>
                <span className="text-3xl font-headline font-black text-tertiary dark:text-[#dcc497]">
                  {succeeded.length}
                </span>
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] font-bold mt-0.5">
                  {t.extractedLabel}
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

          {/* File list card */}
          <div className="bg-surface-container-low dark:bg-[#1c1b1b] rounded-3xl p-6 border border-outline-variant dark:border-[#4c463c] shadow-md flex-1">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-headline text-lg font-bold text-on-surface dark:text-[#e5e2e1]">{t.batchContents}</h3>
              <span className="text-xs text-primary dark:text-[#dcc497] font-bold font-label">{t.filesCount(results.length)}</span>
            </div>

            <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto custom-scrollbar">
              {results.map((result, index) => {
                const isViewing = index === selectedIdx;
                return (
                  <button
                    key={`${result.filename}-${index}`}
                    onClick={() => result.success && setSelectedIdx(index)}
                    className={`group flex items-center justify-between p-3 rounded-full transition-all duration-200 text-left w-full ${
                      isViewing
                        ? "bg-primary/10 dark:bg-[#dcc497]/10 border border-primary/20 dark:border-[#dcc497]/20"
                        : result.success
                        ? "hover:bg-surface-container dark:hover:bg-[#201f1f] cursor-pointer"
                        : "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                        isViewing
                          ? "bg-primary/20 dark:bg-[#dcc497]/20"
                          : "bg-surface-container-highest dark:bg-[#353534] group-hover:bg-primary/10 dark:group-hover:bg-[#dcc497]/10"
                      }`}>
                        <span className={`material-symbols-outlined text-[18px] transition-colors ${
                          isViewing
                            ? "text-primary dark:text-[#dcc497]"
                            : "text-on-surface-variant dark:text-[#cfc5b7] group-hover:text-primary dark:group-hover:text-[#dcc497]"
                        }`}>
                          description
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-bold truncate max-w-[130px] ${
                          isViewing ? "text-primary dark:text-[#dcc497]" : "text-on-surface dark:text-[#e5e2e1]"
                        }`}>
                          {result.filename}
                        </p>
                        <p className="text-[10px] text-on-surface-variant dark:text-[#cfc5b7] uppercase font-medium">
                          {formatFileSize(result.file_size)}
                          {result.success && result.orientation && ` · ${result.orientation}`}
                          {!result.success && ` · ${t.failedLabel}`}
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

          {/* Download actions */}
          <div className="flex flex-col gap-2">
            {succeeded.length === 1 && (
              <button
                onClick={() => handleDownloadText(succeeded[0])}
                className="flex items-center justify-center gap-2 bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] px-6 py-3 rounded-full text-sm font-bold shadow-sm hover:opacity-90 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                {t.downloadTxt}
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

export default NotesResults;
