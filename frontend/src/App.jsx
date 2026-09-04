import { useCallback, useEffect, useState } from "react";
import UploadForm from "./components/UploadForm";
import ProcessingStatus from "./components/ProcessingStatus";
import BatchResults from "./components/BatchResults";
import NotesResults from "./components/NotesResults";
import ErpResults from "./components/ErpResults";
import ErpProfiles from "./components/ErpProfiles";
import QualityReview from "./components/QualityReview";
import ModeToggle from "./components/ModeToggle";
import LicensePage from "./components/LicensePage";
import OperationWarning from "./components/OperationWarning";
import {
  uploadBatch,
  extractNotesBatch,
  checkQualityBatch,
  stageErpJobs,
  uploadErpSource,
  listErpProfiles,
} from "./services/api";
import { useT } from "./i18n/index.jsx";
import { NOTES_ENABLED, ERP_ENABLED } from "./config";

// Groups the files of one upload so the ERP view can ask the backend for
// "this batch" instead of tracking ids by hand.
//
// crypto.randomUUID() only exists in a secure context — over plain http on a
// LAN IP (how this app is actually reached in the plant) it is undefined, so
// it cannot be the only path.
const newBatchId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

// Send each staged job the PDF it was OCR'd from, so the review pane can show
// the page beside the rows. Matched by filename because the backend returns
// one job per document but makes no promise about ordering.
//
// One at a time: a 30-file batch fired at once is 100+ MB of concurrent
// uploads competing with the poll that drives the same screen. Nothing awaits
// this, and a rejected file is swallowed — the pane falls back to markdown.
const attachErpSources = (jobs, files) => {
  const byName = new Map(files.map((f) => [f.name, f]));
  jobs.reduce(
    (chain, job) =>
      chain.then(() => {
        const file = byName.get(job.filename);
        return file ? uploadErpSource(job.job_id, file).catch(() => {}) : null;
      }),
    Promise.resolve(),
  );
};

// Default quality thresholds (must match backend/quality_checker.py)
const DEFAULT_THRESHOLDS = {
  minSharpness:  2.0,
  minBrightness: 25,
  maxBrightness: 245,
  minContrast:   15,
};

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const { t, toggle: toggleLang } = useT();

  // ── Dark mode ────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  // ── Quality thresholds ───────────────────────────────────────────────────────
  const [thresholds, setThresholds] = useState(() => {
    try {
      const saved = localStorage.getItem("qualityThresholds");
      return saved ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) } : DEFAULT_THRESHOLDS;
    } catch {
      return DEFAULT_THRESHOLDS;
    }
  });

  const updateThreshold = (key, value) => {
    setThresholds((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem("qualityThresholds", JSON.stringify(next));
      return next;
    });
  };

  const resetThresholds = () => {
    setThresholds(DEFAULT_THRESHOLDS);
    localStorage.setItem("qualityThresholds", JSON.stringify(DEFAULT_THRESHOLDS));
  };

  const [mode, setMode]                   = useState("ocr");
  const [activePage, setActivePage]       = useState(null); // null | "license"
  const [showOpWarning, setShowOpWarning] = useState(
    () => localStorage.getItem("opsWarnAck") !== "1",
  );
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isQualityChecking, setIsQualityChecking] = useState(false);
  const [qualityData, setQualityData]     = useState(null);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [progress, setProgress]           = useState(0);
  const [results, setResults]             = useState(null);
  const [error, setError]                 = useState(null);
  // Which customer's column set and aliases this upload is read under.
  const [erpProfile, setErpProfile]       = useState("default");
  const [erpProfiles, setErpProfiles]     = useState([{ id: "default", builtin: true }]);
  const [showProfiles, setShowProfiles]   = useState(false);

  // Set once the OCR'd files have been staged as ERP jobs; switches the view
  // over to the 知識通 queue.
  const [erpBatchId, setErpBatchId]       = useState(null);
  // Dual output: run Marker and the text-layer extractor on the same file.
  const [dualMode, setDualMode]           = useState(
    () => localStorage.getItem("dualMode") === "1",
  );

  useEffect(() => {
    localStorage.setItem("dualMode", dualMode ? "1" : "0");
  }, [dualMode]);

  // The customer profiles the deployment knows about. A backend without the
  // endpoint (or one that is down) leaves the built-in entry in place, so the
  // picker never empties and ERP mode keeps working exactly as before.
  const loadErpProfiles = useCallback(() => {
    listErpProfiles()
      .then((d) => setErpProfiles(d.profiles?.length ? d.profiles : [{ id: "default", builtin: true }]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (ERP_ENABLED) loadErpProfiles();
  }, [loadErpProfiles]);

  // ── Mode switching ───────────────────────────────────────────────────────────
  const handleModeChange = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setSelectedFiles([]);
    setIsQualityChecking(false);
    setQualityData(null);
    setIsProcessing(false);
    setProgress(0);
    setResults(null);
    setError(null);
    setErpBatchId(null);
  };

  // ── File selection ───────────────────────────────────────────────────────────
  const handleFilesSelect = (newFiles) => {
    setSelectedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}__${f.size}`));
      const unique   = newFiles.filter((f) => !existing.has(`${f.name}__${f.size}`));
      return [...prev, ...unique];
    });
    setError(null);
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  // ── Quality check (OCR mode only) ────────────────────────────────────────────
  const handleQualityCheck = async () => {
    if (selectedFiles.length === 0) return;
    setIsQualityChecking(true);
    setError(null);
    try {
      const response = await checkQualityBatch(selectedFiles, thresholds);
      setQualityData(response.results);
    } catch (err) {
      setError(err.message || "Quality check failed");
    } finally {
      setIsQualityChecking(false);
    }
  };

  // ── Upload / process ─────────────────────────────────────────────────────────
  // selectedFilenames: string[] from QualityReview checkbox selection (OCR mode)
  const handleUpload = async (force = false, selectedFilenames = null) => {
    const filesToProcess = selectedFilenames
      ? selectedFiles.filter((f) => selectedFilenames.includes(f.name))
      : selectedFiles;

    if (filesToProcess.length === 0) return;

    setQualityData(null);
    setIsProcessing(true);
    setProgress(0);
    setError(null);

    let simTimer = null;

    const startProcessingSim = () => {
      let sim = 20;
      simTimer = setInterval(() => {
        sim += 0.4;
        if (sim >= 95) { sim = 95; clearInterval(simTimer); }
        setProgress(Math.round(sim));
      }, 1000);
    };

    const onUpload = (p) => {
      setProgress(Math.round(p * 0.2));
      if (p >= 100) startProcessingSim();
    };

    try {
      let response;
      if (mode === "notes") {
        response = await extractNotesBatch(filesToProcess, true, onUpload);
      } else {
        // ocr and erp run the identical front half — same engines, same
        // quality gate. Only what happens to the markdown afterwards differs.
        response = await uploadBatch(filesToProcess, onUpload, force, dualMode);
      }

      clearInterval(simTimer);

      if (mode === "erp") {
        const batchId = newBatchId();
        const { jobs } = await stageErpJobs(
          response.results.map((r) => ({
            filename: r.filename,
            markdown: r.markdown_content || "",
            engine: r.engine || "",
            // Dual mode returns the same document twice. markdown_content is
            // Marker's layout reconstruction; fastdoc_markdown is the file's
            // own text layer copied verbatim. Both go over, so the mapper can
            // read structure from one and check digits against the other.
            alt_markdown: r.fastdoc_markdown || "",
            alt_engine: r.fastdoc_markdown ? "fastdoc" : "",
            error: r.success ? "" : r.error || "",
          })),
          batchId,
          erpProfile,
        );
        setErpBatchId(batchId);
        // The PDFs follow behind, deliberately unawaited. The review pane
        // shows the page a row came from, but nothing downstream waits on it,
        // and these are megabytes next to the markdown's kilobytes — holding
        // the table back for them would be the wrong trade. A file that fails
        // to attach loses its page view and nothing else.
        attachErpSources(jobs, filesToProcess);
      }

      setProgress(100);
      await new Promise((r) => setTimeout(r, 400));
      setResults(response.results);
      setIsProcessing(false);
    } catch (err) {
      clearInterval(simTimer);
      setError(err.message || "An error occurred during processing");
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleNewUpload = () => {
    setSelectedFiles([]);
    setQualityData(null);
    setResults(null);
    setProgress(0);
    setError(null);
    setIsProcessing(false);
    setErpBatchId(null);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-background dark:bg-[#131313] text-on-background dark:text-[#e5e2e1] font-body min-h-screen flex relative">
      {/* Paper texture overlay */}
      <div className="fixed inset-0 pointer-events-none paper-texture z-0" />

      {/* ── Sidebar (desktop) ──────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col h-screen w-64 sticky left-0 top-0 rounded-r-3xl bg-surface-container-low dark:bg-[#1c1b1b] border-r border-outline-variant dark:border-[#4c463c] py-8 gap-1 z-20 shadow-[10px_0_30px_rgba(0,0,0,0.04)]">
        {/* Logo */}
        <div className="px-8 mb-10">
          <h2 className="font-headline italic text-xl text-primary dark:text-[#dcc497] font-semibold tracking-tight">
            {t.productName}
          </h2>
          <p className="text-on-surface-variant dark:text-[#cfc5b7] text-[10px] opacity-60 uppercase tracking-widest mt-0.5">
            {t.productSubtitle}
          </p>
        </div>

        {/* Mode navigation (sliding toggle) */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          <ModeToggle mode={mode} onChange={handleModeChange} className="mx-2 mb-3" />

          {isQualityChecking && (
            <div className="flex items-center gap-3 rounded-full mx-2 px-4 py-3 bg-primary/10 dark:bg-[#dcc497]/10 text-primary dark:text-[#dcc497] text-sm font-bold">
              <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
              <span className="font-label">{t.checkingNav}</span>
            </div>
          )}

          {qualityData && !isProcessing && (
            <div className="flex items-center gap-3 rounded-full mx-2 px-4 py-3 bg-tertiary/10 dark:bg-[#dcc497]/10 text-tertiary dark:text-[#dcc497] text-sm font-bold">
              <span className="material-symbols-outlined text-[20px]">analytics</span>
              <span className="font-label">{t.reviewing}</span>
            </div>
          )}

          {isProcessing && (
            <div className="flex items-center gap-3 rounded-full mx-2 px-4 py-3 bg-primary/10 dark:bg-[#dcc497]/10 text-primary dark:text-[#dcc497] text-sm font-bold">
              <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
              <span className="font-label">{t.processingNav}</span>
            </div>
          )}

          {results && (
            <div className="flex items-center gap-3 rounded-full mx-2 px-4 py-3 bg-primary/10 dark:bg-[#dcc497]/10 text-primary dark:text-[#dcc497] text-sm font-bold">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <span className="font-label">{t.batchComplete}</span>
            </div>
          )}
        </nav>

        {/* New Batch CTA */}
        {(results || isProcessing || qualityData || isQualityChecking) && (
          <div className="px-6 pb-4">
            <button
              onClick={handleNewUpload}
              className="w-full bg-secondary dark:bg-[#c6c6c6] text-on-secondary dark:text-[#131313] rounded-full py-3 text-sm font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t.newBatch}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-2 pt-4 border-t border-outline-variant dark:border-[#4c463c]">
          <button
            onClick={() => setActivePage("license")}
            className={`w-full flex items-center gap-3 rounded-full mx-2 px-4 py-2.5 text-sm transition-colors ${
              activePage === "license"
                ? "bg-primary/10 dark:bg-[#dcc497]/10 text-primary dark:text-[#dcc497] font-semibold"
                : "text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">gavel</span>
            <span className="font-label">{t.licenseNav}</span>
          </button>
          {/* Attribution — Marker (Datalab) is GPL-3.0 / model weights non-commercial */}
          <p className="px-4 mt-3 text-[10px] leading-snug text-on-surface-variant dark:text-[#cfc5b7] opacity-50 font-label">
            {t.aboutEngineBody}
          </p>
        </div>
      </aside>

      {/* ── Main content area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen relative z-10">
        {/* Top header */}
        <header className="sticky top-0 z-30 bg-background/80 dark:bg-[#131313]/80 backdrop-blur-md border-b border-outline-variant dark:border-[#4c463c] flex justify-between items-center px-6 md:px-10 py-4">
          <div className="flex items-center gap-8">
            {/* Mobile logo */}
            <span className="md:hidden font-headline italic text-lg text-primary dark:text-[#dcc497] font-semibold">
              {t.productName}
            </span>
            {/* Desktop breadcrumb */}
            <nav className="hidden md:flex items-center gap-8 font-label text-sm uppercase tracking-widest">
              <span className="text-primary dark:text-[#dcc497] font-bold border-b-2 border-tertiary dark:border-[#dcc497] pb-0.5">
                {mode === "notes" ? t.modeNotes : mode === "erp" ? t.modeErp : t.modeOcr}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* License & fee notice */}
            <button
              onClick={() => setActivePage("license")}
              title={t.licenseNav}
              aria-label={t.licenseNav}
              className="p-2 text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] rounded-full transition-all"
            >
              <span className="material-symbols-outlined text-[22px]">gavel</span>
            </button>
            {/* Language toggle */}
            <button
              onClick={toggleLang}
              className="px-3 py-1.5 text-xs font-label font-semibold text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] rounded-full border border-outline-variant dark:border-[#4c463c] transition-all"
            >
              {t.langToggle}
            </button>
            {/* Dark mode toggle */}
            <button
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2 text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] rounded-full transition-all"
            >
              <span className="material-symbols-outlined text-[22px]">
                {isDark ? "light_mode" : "dark_mode"}
              </span>
            </button>
            {/* Quick-action upload button */}
            {!isProcessing && !isQualityChecking && !qualityData && !results && selectedFiles.length > 0 && (
              <button
                onClick={mode === "notes" ? () => handleUpload() : handleQualityCheck}
                className="px-5 py-2 bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] rounded-full font-label font-semibold text-sm hover:opacity-90 transition-all shadow-sm"
              >
                {mode === "notes"
                  ? t.btnExtractNotesN(selectedFiles.length)
                  : t.btnCheckQualityN(selectedFiles.length)}
              </button>
            )}
          </div>
        </header>

        {/* Main scrollable content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {activePage === "license" ? (
            <LicensePage onBack={() => setActivePage(null)} />
          ) : showProfiles ? (
            <ErpProfiles
              onClose={() => setShowProfiles(false)}
              onProfileSaved={(id) => {
                setErpProfile(id);
                loadErpProfiles();
              }}
            />
          ) : (
          <>
          {/* Error banner */}
          {error && (
            <div className="mx-6 md:mx-10 mt-6 p-4 bg-error-container dark:bg-[#93000a]/30 border border-error/30 rounded-2xl">
              <div className="flex items-center gap-2 text-error dark:text-[#ffb4ab]">
                <span className="material-symbols-outlined">error</span>
                <span className="font-semibold text-sm">Error:</span>
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* ── Customer profile picker (ERP mode) ───────────────────────────────
              Which column set and alias list this upload is read under. Sits
              above the drop zone because it has to be decided before the
              files go anywhere — a batch staged under the wrong customer's
              profile has to be re-uploaded, not re-tagged. */}
          {mode === "erp" && !isProcessing && !erpBatchId && (
            <div className="mx-6 md:mx-10 mt-6 flex flex-wrap items-center gap-3">
              <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                {t.erpProfile}
              </span>
              <select
                value={erpProfile}
                onChange={(e) => setErpProfile(e.target.value)}
                className="px-3 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] bg-transparent text-xs font-label text-on-background dark:text-[#e5e2e1]"
              >
                {erpProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.builtin ? t.erpProfileDefault : p.name || p.id}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowProfiles(true)}
                className="px-4 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] text-xs font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all"
              >
                {t.erpProfileManage}
              </button>
            </div>
          )}

          {/* ── Upload form ──────────────────────────────────────────────────────── */}
          {!isQualityChecking && !qualityData && !isProcessing && !results && (
            <UploadForm
              onFilesSelect={handleFilesSelect}
              selectedFiles={selectedFiles}
              onRemoveFile={handleRemoveFile}
              onUpload={mode === "notes" ? () => handleUpload() : handleQualityCheck}
              isProcessing={isProcessing}
              mode={mode}
              thresholds={thresholds}
              onThresholdChange={updateThreshold}
              onThresholdReset={resetThresholds}
              defaultThresholds={DEFAULT_THRESHOLDS}
              dualMode={dualMode}
              onDualModeChange={setDualMode}
            />
          )}

          {/* ── Quality checking (loading) ────────────────────────────────────── */}
          {isQualityChecking && (
            <section className="flex-1 flex items-center justify-center px-6 py-10" style={{ minHeight: "60vh" }}>
              <div className="flex flex-col items-center gap-4 text-center">
                <span className="material-symbols-outlined text-5xl text-primary dark:text-[#dcc497] animate-spin">analytics</span>
                <p className="font-headline text-xl text-on-background dark:text-[#e5e2e1] font-semibold">
                  {t.checkingQualityHeading}
                </p>
                <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] font-body">
                  {t.checkingQualityDesc(selectedFiles.length)}
                </p>
              </div>
            </section>
          )}

          {/* ── Quality review ────────────────────────────────────────────────── */}
          {qualityData && !isProcessing && (
            <QualityReview
              qualityResults={qualityData}
              thresholds={thresholds}
              onProceed={(selectedFilenames) => handleUpload(true, selectedFilenames)}
              onBack={() => setQualityData(null)}
            />
          )}

          {/* ── Processing ───────────────────────────────────────────────────────── */}
          {isProcessing && (
            <ProcessingStatus
              progress={progress}
              fileCount={selectedFiles.length}
              mode={mode}
            />
          )}

          {/* ── Results ──────────────────────────────────────────────────────────── */}
          {!isProcessing && results && mode === "ocr" && (
            <BatchResults results={results} onNewUpload={handleNewUpload} />
          )}

          {!isProcessing && results && mode === "notes" && (
            <NotesResults results={results} onNewUpload={handleNewUpload} />
          )}

          {!isProcessing && erpBatchId && mode === "erp" && (
            <ErpResults batchId={erpBatchId} onNewUpload={handleNewUpload} />
          )}
          </>
          )}
        </main>
      </div>

      {/* ── Mobile bottom nav (hidden when it would be empty) ──────────────────── */}
      {(NOTES_ENABLED || ERP_ENABLED || results) && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-container-low dark:bg-[#1c1b1b] py-3 px-6 flex items-center gap-3 z-50 rounded-t-3xl border-t border-outline-variant dark:border-[#4c463c] shadow-2xl">
          <ModeToggle mode={mode} onChange={handleModeChange} className="flex-1" />
          {results && (
            <button
              onClick={handleNewUpload}
              className="flex flex-col items-center gap-1 text-secondary dark:text-[#c6c6c6]"
            >
              <span className="material-symbols-outlined">add_circle</span>
              <span className="text-[10px] font-label">{t.newBatch}</span>
            </button>
          )}
        </nav>
      )}

      {/* ── System licensing warning (first use) ────────────────────────────────── */}
      <OperationWarning
        open={showOpWarning}
        onAck={() => {
          localStorage.setItem("opsWarnAck", "1");
          setShowOpWarning(false);
        }}
        onViewLicense={() => {
          localStorage.setItem("opsWarnAck", "1");
          setShowOpWarning(false);
          setActivePage("license");
        }}
      />
    </div>
  );
}

export default App;
