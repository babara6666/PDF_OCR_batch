import { useState } from "react";
import Header from "./components/Header";
import UploadForm from "./components/UploadForm";
import ProcessingStatus from "./components/ProcessingStatus";
import BatchResults from "./components/BatchResults";
import NotesResults from "./components/NotesResults";
import { uploadBatch, extractNotesBatch } from "./services/api";

// ─── Mode definitions ────────────────────────────────────────────────────────
const MODES = [
  {
    id: "ocr",
    label: "Full OCR",
    icon: "description",
    description: "Convert PDF / image files to full Markdown",
  },
  {
    id: "notes",
    label: "Extract Notes",
    icon: "sticky_note_2",
    description: "Detect and extract the 'Notes:' section from engineering drawings",
  },
];

// ─── App ─────────────────────────────────────────────────────────────────────
function App() {
  // Shared state
  const [mode, setMode] = useState("ocr"); // "ocr" | "notes"

  // Per-mode state (reset when switching mode)
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [progress, setProgress]           = useState(0);
  const [results, setResults]             = useState(null);
  const [error, setError]                 = useState(null);

  // ── Mode switching ──────────────────────────────────────────────────────────
  const handleModeChange = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setSelectedFiles([]);
    setIsProcessing(false);
    setProgress(0);
    setResults(null);
    setError(null);
  };

  // ── File selection ──────────────────────────────────────────────────────────
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

  // ── Upload / process ────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      let response;

      if (mode === "ocr") {
        response = await uploadBatch(selectedFiles, (p) => setProgress(p));
      } else {
        // Notes extraction mode — include crop images for visual verification
        response = await extractNotesBatch(
          selectedFiles,
          true,
          (p) => setProgress(p),
        );
      }

      setResults(response.results);
      setIsProcessing(false);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err.message || "An error occurred during processing");
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleNewUpload = () => {
    setSelectedFiles([]);
    setResults(null);
    setProgress(0);
    setError(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen flex flex-col text-slate-900 dark:text-white transition-colors duration-200">
      <Header />

      <main className="flex-1 flex flex-col items-center py-10 px-4 sm:px-40">

        {/* Mode switcher — shown only when not processing / showing results */}
        {!isProcessing && !results && (
          <div className="w-full max-w-[640px] mb-8">
            <div className="flex rounded-xl border border-slate-200 dark:border-[#233648] bg-white dark:bg-[#15202b] p-1 gap-1 shadow-sm">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleModeChange(m.id)}
                  className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-3 px-4 transition-all ${
                    mode === m.id
                      ? "bg-primary text-white shadow-md shadow-primary/20"
                      : "text-slate-600 dark:text-[#92adc9] hover:bg-slate-100 dark:hover:bg-[#192633]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    {m.icon}
                  </span>
                  <span className="text-sm font-bold leading-tight">{m.label}</span>
                  <span
                    className={`text-[10px] leading-tight text-center hidden sm:block ${
                      mode === m.id ? "text-blue-100" : "text-slate-400 dark:text-[#6a7e91]"
                    }`}
                  >
                    {m.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="w-full max-w-[640px] mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <span className="material-symbols-outlined">error</span>
              <span className="font-semibold">Error:</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Upload form */}
        {!isProcessing && !results && (
          <UploadForm
            onFilesSelect={handleFilesSelect}
            selectedFiles={selectedFiles}
            onRemoveFile={handleRemoveFile}
            onUpload={handleUpload}
            isProcessing={isProcessing}
            // Pass mode so the form can adjust its heading/button label
            mode={mode}
          />
        )}

        {/* Processing spinner */}
        {isProcessing && (
          <ProcessingStatus
            progress={progress}
            fileCount={selectedFiles.length}
          />
        )}

        {/* Results */}
        {!isProcessing && results && mode === "ocr" && (
          <BatchResults results={results} onNewUpload={handleNewUpload} />
        )}

        {!isProcessing && results && mode === "notes" && (
          <NotesResults results={results} onNewUpload={handleNewUpload} />
        )}
      </main>
    </div>
  );
}

export default App;
