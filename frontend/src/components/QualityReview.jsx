import { useState } from "react";
import { useT } from "../i18n/index.jsx";

const DEFAULT_THRESHOLDS = { minSharpness: 2.0, minBrightness: 25, maxBrightness: 245, minContrast: 15 };

const MetricBar = ({ value, min, max }) => {
  const ok = max !== undefined ? value >= min && value <= max : value >= min;
  const ratio = max !== undefined
    ? Math.min(1, Math.max(0, (value - min) / (max - min)))
    : Math.min(1, Math.max(0, value / (min * 4)));
  return (
    <div className="h-1.5 w-full bg-surface-container-highest dark:bg-[#353534] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${ok ? "bg-primary dark:bg-[#8D9965]" : "bg-error dark:bg-[#ffb4ab]"}`}
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
};

const formatFileSize = (bytes) => {
  if (!bytes)              return "—";
  if (bytes < 1024)        return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};

const QualityReview = ({ qualityResults, thresholds = DEFAULT_THRESHOLDS, onProceed, onBack }) => {
  const { t } = useT();
  const { minSharpness, minBrightness, maxBrightness, minContrast } = thresholds;

  // Checkbox state: all checked by default
  const [checked, setChecked] = useState(
    () => new Set(qualityResults.map((r) => r.filename))
  );

  const toggleFile = (filename) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === qualityResults.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(qualityResults.map((r) => r.filename)));
    }
  };

  const passed   = qualityResults.filter((r) => r.passed).length;
  const total    = qualityResults.length;
  const allPass  = passed === total;
  const noneChecked = checked.size === 0;
  const allChecked  = checked.size === total;

  const headingText = allPass
    ? t.qualityAllPass(total)
    : t.qualityPartial(passed, total);

  const descText = allPass ? t.qualityDescAllPass : t.qualityDescPartial;

  return (
    <section className="flex-1 px-6 md:px-10 py-10">
      {/* Header */}
      <div className="mb-6">
        <span className="text-primary dark:text-[#dcc497] font-label font-bold tracking-[0.2em] text-xs uppercase">
          {t.qualityReviewLabel}
        </span>
        <h2 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter leading-tight mt-1">
          {headingText}
        </h2>
        <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body mt-1">
          {descText}
        </p>
      </div>

      {/* Select all / none row */}
      <div className="flex items-center gap-3 mb-4 max-w-4xl">
        <span className="text-xs text-on-surface-variant dark:text-[#cfc5b7] font-label uppercase tracking-widest">
          {checked.size} / {total}
        </span>
        <button
          onClick={toggleAll}
          className="text-xs font-label font-semibold text-primary dark:text-[#dcc497] hover:opacity-70 transition-opacity"
        >
          {allChecked ? t.deselectAll : t.selectAll}
        </button>
      </div>

      {/* File cards */}
      <div className="flex flex-col gap-3 mb-8 max-w-4xl">
        {qualityResults.map((r, i) => {
          const isChecked = checked.has(r.filename);
          return (
            <div
              key={`${r.filename}-${i}`}
              onClick={() => toggleFile(r.filename)}
              className={`rounded-3xl border p-6 cursor-pointer transition-all select-none ${
                isChecked
                  ? r.passed
                    ? "bg-surface-container-low dark:bg-[#1c1b1b] border-primary/30 dark:border-[#8D9965]/30 ring-1 ring-primary/20 dark:ring-[#8D9965]/20"
                    : "bg-error-container/20 dark:bg-[#93000a]/10 border-error/30 dark:border-[#ffb4ab]/20 ring-1 ring-error/20 dark:ring-[#ffb4ab]/10"
                  : "bg-surface-container-lowest dark:bg-[#181818] border-outline-variant/50 dark:border-[#4c463c]/50 opacity-50"
              }`}
            >
              {/* File name row */}
              <div className="flex items-center gap-3 mb-5">
                {/* Checkbox */}
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                  isChecked
                    ? "bg-primary dark:bg-[#8D9965] border-primary dark:border-[#8D9965]"
                    : "border-outline dark:border-[#4c463c] bg-transparent"
                }`}>
                  {isChecked && (
                    <span className="material-symbols-outlined text-white text-[14px]" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                  )}
                </div>

                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    r.passed ? "bg-primary/10 dark:bg-[#8D9965]/10" : "bg-error/10 dark:bg-[#ffb4ab]/10"
                  }`}>
                    <span className={`material-symbols-outlined text-[16px] ${
                      r.passed ? "text-primary dark:text-[#8D9965]" : "text-error dark:text-[#ffb4ab]"
                    }`} style={{ fontVariationSettings: "'FILL' 1" }}>
                      {r.passed ? "check_circle" : "warning"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface dark:text-[#e5e2e1] truncate">
                      {r.filename}
                    </p>
                    <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7]">
                      {formatFileSize(r.file_size)}
                      {!r.passed && r.reason && (
                        <span className="text-error dark:text-[#ffb4ab] ml-2">· {r.reason}</span>
                      )}
                    </p>
                  </div>
                </div>

                <span className={`text-[10px] font-label font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                  r.passed
                    ? "bg-primary/10 dark:bg-[#8D9965]/10 text-primary dark:text-[#8D9965]"
                    : "bg-error/10 dark:bg-[#ffb4ab]/10 text-error dark:text-[#ffb4ab]"
                }`}>
                  {r.passed ? t.tagPassed : t.tagWarning}
                </span>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pl-8">
                {/* Sharpness */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">blur_on</span>
                      {t.sharpness}
                    </span>
                    <span className={`text-xs font-mono font-bold ${
                      r.blur_score >= minSharpness ? "text-primary dark:text-[#8D9965]" : "text-error dark:text-[#ffb4ab]"
                    }`}>
                      {r.blur_score?.toFixed(2)}
                      <span className="text-on-surface-variant dark:text-[#cfc5b7] font-normal ml-1 text-[10px]">/ ≥{minSharpness}</span>
                    </span>
                  </div>
                  <MetricBar value={r.blur_score} min={minSharpness} />
                </div>

                {/* Brightness */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">light_mode</span>
                      {t.brightness}
                    </span>
                    <span className={`text-xs font-mono font-bold ${
                      r.brightness >= minBrightness && r.brightness <= maxBrightness
                        ? "text-primary dark:text-[#8D9965]"
                        : "text-error dark:text-[#ffb4ab]"
                    }`}>
                      {r.brightness?.toFixed(0)}
                      <span className="text-on-surface-variant dark:text-[#cfc5b7] font-normal ml-1 text-[10px]">{minBrightness}–{maxBrightness}</span>
                    </span>
                  </div>
                  <MetricBar value={r.brightness} min={minBrightness} max={maxBrightness} />
                </div>

                {/* Contrast */}
                <div>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">contrast</span>
                      {t.contrast}
                    </span>
                    <span className={`text-xs font-mono font-bold ${
                      r.contrast >= minContrast ? "text-primary dark:text-[#8D9965]" : "text-error dark:text-[#ffb4ab]"
                    }`}>
                      {r.contrast?.toFixed(0)}
                      <span className="text-on-surface-variant dark:text-[#cfc5b7] font-normal ml-1 text-[10px]">/ ≥{minContrast}</span>
                    </span>
                  </div>
                  <MetricBar value={r.contrast} min={minContrast} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="max-w-4xl flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <button
          onClick={() => onProceed([...checked])}
          disabled={noneChecked}
          className="flex items-center gap-2 bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] px-8 py-3.5 rounded-full font-headline font-semibold text-base shadow-lg hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[20px]">brush</span>
          {noneChecked ? t.noneSelected : t.startOcr(checked.size)}
        </button>
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-on-surface-variant dark:text-[#cfc5b7] hover:text-on-surface dark:hover:text-[#e5e2e1] px-4 py-3.5 rounded-full font-label text-sm transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          {t.goBack}
        </button>
        {!allPass && checked.size > 0 && (
          <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-60 font-body sm:ml-auto">
            {t.warningNote}
          </p>
        )}
      </div>
    </section>
  );
};

export default QualityReview;
