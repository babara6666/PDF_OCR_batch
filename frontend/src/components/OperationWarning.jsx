import { useT } from "../i18n/index.jsx";

// System-level licensing warning shown before the user operates the software.
// Acknowledgement is persisted in localStorage so it appears once; the same
// content stays reachable any time from the sidebar "License & Fee Notice" page.
const OperationWarning = ({ open, onAck, onViewLicense }) => {
  const { t } = useT();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-3xl bg-surface-container-low dark:bg-[#1c1b1b] border border-error/40 dark:border-[#93000a]/50 shadow-2xl p-8">
        {/* Icon + title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-error-container dark:bg-[#93000a]/30 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-error dark:text-[#ffb4ab] text-[24px]">gpp_maybe</span>
          </div>
          <h2 className="font-headline text-xl text-on-background dark:text-[#e5e2e1] font-semibold">
            {t.opWarnTitle}
          </h2>
        </div>

        <p className="text-sm font-semibold text-on-surface dark:text-[#e5e2e1] mb-2">{t.opWarnLead}</p>
        <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] leading-relaxed mb-4">
          {t.opWarnBody}
        </p>

        <ul className="space-y-2 mb-6">
          {[t.opWarnPoint1, t.opWarnPoint2, t.opWarnPoint3].map((pt, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-on-surface-variant dark:text-[#cfc5b7] leading-relaxed">
              <span className="material-symbols-outlined text-[16px] text-primary dark:text-[#dcc497] mt-0.5 flex-shrink-0">chevron_right</span>
              <span>{pt}</span>
            </li>
          ))}
        </ul>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onViewLicense}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label font-semibold text-on-surface dark:text-[#e5e2e1] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">gavel</span>
            {t.opWarnView}
          </button>
          <button
            onClick={onAck}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-sm font-label font-semibold hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[18px]">check</span>
            {t.opWarnAck}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OperationWarning;
