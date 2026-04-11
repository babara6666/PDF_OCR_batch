import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";

const ProcessingStatus = ({ progress, fileCount, mode = "ocr" }) => {
  const { t } = useT();
  const [dots, setDots] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setDots((p) => (p.length >= 3 ? "" : p + ".")), 500);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setElapsedSeconds((p) => p + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
  };

  return (
    <section className="flex-1 flex items-center justify-center px-6 md:px-10 py-10">
      <div className="max-w-3xl w-full">
        {/* Heading */}
        <div className="text-center mb-12">
          <h1 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] mb-4 font-semibold tracking-tight">
            {t.transmutingScript}
          </h1>
          <p className="font-body text-on-surface-variant dark:text-[#cfc5b7] max-w-md mx-auto text-base leading-relaxed">
            {mode === "notes" ? t.processingIntroNotes : t.processingIntroOcr}{" "}
            <span className="text-primary dark:text-[#dcc497] font-semibold">
              {t.filesLabel(fileCount)}
            </span>{" "}
            {mode === "notes" ? "" : t.intoStructuredLayers}{dots}
          </p>
        </div>

        {/* Glass panel card */}
        <div className="glass-panel rounded-3xl p-8 md:p-12 border border-outline-variant dark:border-[#4c463c] shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          {/* Progress header */}
          <div className="flex justify-between items-end mb-6 px-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-label text-on-surface-variant dark:text-[#cfc5b7] uppercase tracking-[0.2em]">
                {t.statusLabel}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-3xl text-primary dark:text-[#dcc497] font-bold">
                  {progress}%
                </span>
                <div className="flex gap-1">
                  {[0, 150, 300].map((delay) => (
                    <div
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full bg-primary dark:bg-[#dcc497] animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-label text-on-surface-variant dark:text-[#cfc5b7] uppercase tracking-[0.2em] block mb-1">
                {t.elapsedLabel}
              </span>
              <p className="font-mono text-xl text-secondary dark:text-[#c6c6c6]">
                {formatTime(elapsedSeconds)}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-4 w-full bg-surface-container-highest dark:bg-[#353534] rounded-full overflow-hidden mb-10 p-0.5 border border-outline-variant/30 dark:border-[#4c463c]/30">
            <div
              className="h-full ripple-moss rounded-full relative overflow-hidden transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-white/30 animate-shimmer" />
            </div>
          </div>

          {/* 3-column stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface-container-low dark:bg-[#201f1f] p-5 rounded-full border border-outline-variant/30 dark:border-[#4c463c]/50 flex flex-col items-center text-center">
              <div className="flex items-center gap-2 text-on-surface-variant dark:text-[#cfc5b7] mb-2">
                <span className="material-symbols-outlined text-sm">text_fields</span>
                <span className="text-[10px] font-label uppercase tracking-widest">{t.ocrExtraction}</span>
              </div>
              <p className="font-label text-sm text-secondary dark:text-[#c6c6c6] font-semibold">
                {progress < 20 ? t.uploading : progress < 95 ? t.processingDots : t.finalizing}
              </p>
              <div className="kintsugi-line w-10 mt-3" />
            </div>

            <div className="bg-surface-container-low dark:bg-[#201f1f] p-5 rounded-full border border-outline-variant/30 dark:border-[#4c463c]/50 flex flex-col items-center text-center">
              <div className="flex items-center gap-2 text-on-surface-variant dark:text-[#cfc5b7] mb-2">
                <span className="material-symbols-outlined text-sm">data_object</span>
                <span className="text-[10px] font-label uppercase tracking-widest">{t.semanticAnalysis}</span>
              </div>
              <p className="font-label text-sm text-secondary dark:text-[#c6c6c6] font-semibold">
                {progress >= 40 ? t.layerActive : t.standby}
              </p>
              <div className="kintsugi-line w-10 mt-3" />
            </div>

            <div className="bg-surface-container-low dark:bg-[#201f1f] p-5 rounded-full border border-outline-variant/30 dark:border-[#4c463c]/50 flex flex-col items-center text-center">
              <div className="flex items-center gap-2 text-on-surface-variant dark:text-[#cfc5b7] mb-2">
                <span className="material-symbols-outlined text-sm">timer</span>
                <span className="text-[10px] font-label uppercase tracking-widest">{t.elapsedTime}</span>
              </div>
              <p className="font-label text-sm text-secondary dark:text-[#c6c6c6] font-semibold">
                {formatTime(elapsedSeconds)}
              </p>
              <div className="kintsugi-line w-10 mt-3" />
            </div>
          </div>
        </div>

        {/* Info note */}
        <div className="mt-8 flex items-center gap-3 p-4 rounded-full bg-surface-container-low dark:bg-[#1c1b1b] border border-outline-variant dark:border-[#4c463c]">
          <span className="material-symbols-outlined text-tertiary dark:text-[#dcc497] text-xl flex-shrink-0">info</span>
          <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] font-body">
            {t.keepWindowOpen}
          </p>
        </div>
      </div>
    </section>
  );
};

export default ProcessingStatus;
