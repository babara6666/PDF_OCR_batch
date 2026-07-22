import { useT } from "../i18n/index.jsx";

// Two-position sliding switch for OCR / Notes modes.
const MODES = [
  { id: "ocr",   icon: "description" },
  { id: "notes", icon: "sticky_note_2" },
];

const ModeToggle = ({ mode, onChange, className = "" }) => {
  const { t } = useT();
  const activeIndex = MODES.findIndex((m) => m.id === mode);

  return (
    <div className={className}>
      <div className="relative flex rounded-full bg-surface-container-high dark:bg-[#2a2a2a] p-1 border border-outline-variant dark:border-[#4c463c] shadow-inner">
        {/* Sliding knob (width == one segment; moves by 100% of its own width) */}
        <div
          className="absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-primary dark:bg-[#dcc497] shadow-md transition-transform duration-300 ease-out"
          style={{ transform: activeIndex === 0 ? "translateX(0)" : "translateX(100%)" }}
        />
        {MODES.map((m) => {
          const label  = m.id === "ocr" ? t.modeOcr : t.modeNotes;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-label font-semibold transition-colors duration-200 ${
                active
                  ? "text-on-primary dark:text-[#3d2e0e]"
                  : "text-on-surface-variant dark:text-[#cfc5b7]"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{m.icon}</span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModeToggle;
