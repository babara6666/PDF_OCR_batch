import { useState, useEffect } from "react";
import UploadForm from "./components/UploadForm";
import ProcessingStatus from "./components/ProcessingStatus";
import BatchResults from "./components/BatchResults";
import NotesResults from "./components/NotesResults";
import QualityReview from "./components/QualityReview";
import { uploadBatch, extractNotesBatch, checkQualityBatch } from "./services/api";
import { useT } from "./i18n/index.jsx";

// Mode icon map (labels come from translations)
const MODE_IDS = [
  { id: "ocr",   icon: "description" },
  { id: "notes", icon: "sticky_note_2" },
];

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
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isQualityChecking, setIsQualityChecking] = useState(false);
  const [qualityData, setQualityData]     = useState(null);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [progress, setProgress]           = useState(0);
  const [results, setResults]             = useState(null);
  const [error, setError]                 = useState(null);

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
      if (mode === "ocr") {
        response = await uploadBatch(filesToProcess, onUpload, force);
      } else {
        response = await extractNotesBatch(filesToProcess, true, onUpload);
      }

      clearInterval(simTimer);
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
  };

  // ── Sidebar nav item ─────────────────────────────────────────────────────────
  const NavItem = ({ m }) => {
    const label  = m.id === "ocr" ? t.modeOcr : t.modeNotes;
    const active = mode === m.id && !isProcessing && !results;
    return (
      <button
        onClick={() => handleModeChange(m.id)}
        className={`w-full flex items-center gap-3 rounded-full mx-2 px-4 py-3 text-sm transition-all duration-200 ${
          active
            ? "bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] font-bold scale-95 shadow-md"
            : "text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{m.icon}</span>
        <span className="font-label">{label}</span>
      </button>
    );
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

        {/* Mode navigation */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          {MODE_IDS.map((m) => (
            <NavItem key={m.id} m={m} />
          ))}

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
          <a
            href="#"
            className="flex items-center gap-3 rounded-full mx-2 px-4 py-2.5 text-sm text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">help_outline</span>
            <span className="font-label">{t.support}</span>
          </a>
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
                {mode === "ocr" ? t.modeOcr : t.modeNotes}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3">
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
                onClick={mode === "ocr" ? handleQualityCheck : () => handleUpload()}
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

          {/* ── Upload form ──────────────────────────────────────────────────────── */}
          {!isQualityChecking && !qualityData && !isProcessing && !results && (
            <UploadForm
              onFilesSelect={handleFilesSelect}
              selectedFiles={selectedFiles}
              onRemoveFile={handleRemoveFile}
              onUpload={mode === "ocr" ? handleQualityCheck : () => handleUpload()}
              isProcessing={isProcessing}
              mode={mode}
              thresholds={thresholds}
              onThresholdChange={updateThreshold}
              onThresholdReset={resetThresholds}
              defaultThresholds={DEFAULT_THRESHOLDS}
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
        </main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-container-low dark:bg-[#1c1b1b] py-3 px-6 flex justify-around items-center z-50 rounded-t-3xl border-t border-outline-variant dark:border-[#4c463c] shadow-2xl">
        {MODE_IDS.map((m) => {
          const label = m.id === "ocr" ? t.modeOcr : t.modeNotes;
          return (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`flex flex-col items-center gap-1 transition-colors ${
                mode === m.id
                  ? "text-primary dark:text-[#dcc497]"
                  : "text-on-surface-variant dark:text-[#cfc5b7]"
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={mode === m.id ? { fontVariationSettings: "'FILL' 1" } : {}}
              >
                {m.icon}
              </span>
              <span className="text-[10px] font-label">{label}</span>
            </button>
          );
        })}
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
    </div>
  );
}

export default App;
