import { useT } from "../i18n/index.jsx";
import { NOTES_ENABLED, ERP_ENABLED } from "../config";

// Sliding switch across however many modes are enabled. Both extra modes sit
// behind flags, so this renders 1, 2, or 3 positions depending on config —
// the knob is sized and moved from the count rather than hardcoded to halves.
const ALL_MODES = [
  { id: "ocr", icon: "description", enabled: true },
  { id: "notes", icon: "sticky_note_2", enabled: NOTES_ENABLED },
  { id: "erp", icon: "table_view", enabled: ERP_ENABLED },
];

const ModeToggle = ({ mode, onChange, className = "" }) => {
  const { t } = useT();
  const modes = ALL_MODES.filter((m) => m.enabled);

  // One position is not a choice — render nothing rather than a dead switch.
  if (modes.length < 2) return null;

  const activeIndex = Math.max(
    0,
    modes.findIndex((m) => m.id === mode),
  );
  const label = { ocr: t.modeOcr, notes: t.modeNotes, erp: t.modeErp };

  return (
    <div className={className}>
      <div className="relative flex rounded-full bg-surface-container-high dark:bg-[#2a2a2a] p-1 border border-outline-variant dark:border-[#4c463c] shadow-inner">
        {/* Sliding knob: one segment wide, moved by whole multiples of itself */}
        <div
          className="absolute left-1 top-1 bottom-1 rounded-full bg-primary dark:bg-[#dcc497] shadow-md transition-transform duration-300 ease-out"
          style={{
            width: `calc(${100 / modes.length}% - ${8 / modes.length}px)`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {modes.map((m) => {
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
              <span className="truncate">{label[m.id]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModeToggle;
