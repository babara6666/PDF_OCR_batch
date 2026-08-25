import { useT } from "../i18n/index.jsx";

// ── Commercial-fee tiers ──────────────────────────────────────────────────────
//   paid  → 商用需付費／授權   (amber)
//   free  → 免費              (green)
const TIER = { PAID: "paid", FREE: "free" };

// Component inventory. Versions reflect the pinned/bundled build; full terms are
// governed by each component's official LICENSE file (see footnote).
const GROUPS = [
  {
    key: "licenseGroupFrontend",
    rows: [
      { name: "React / React DOM",       version: "18.2",      license: "MIT",                 tier: TIER.FREE },
      { name: "Vite",                    version: "5.x",       license: "MIT",                 tier: TIER.FREE },
      { name: "Tailwind CSS",            version: "3.4",       license: "MIT",                 tier: TIER.FREE },
      { name: "axios",                   version: "1.6",       license: "MIT",                 tier: TIER.FREE },
      { name: "react-markdown",          version: "9.0",       license: "MIT",                 tier: TIER.FREE },
      { name: "JSZip",                   version: "3.10",      license: "MIT / GPLv3 (dual)",  tier: TIER.FREE },
      { name: "FileSaver.js",            version: "2.0",       license: "MIT",                 tier: TIER.FREE },
      { name: "Material Symbols (icons)",version: "—",         license: "Apache-2.0",          tier: TIER.FREE },
    ],
  },
  {
    key: "licenseGroupBackend",
    rows: [
      { name: "FastAPI",                 version: "0.135",     license: "MIT",                 tier: TIER.FREE },
      { name: "Uvicorn",                 version: "0.42",      license: "BSD-3-Clause",        tier: TIER.FREE },
      { name: "Pydantic",                version: "2.12",      license: "MIT",                 tier: TIER.FREE },
      { name: "PyTorch (torch)",         version: "2.11",      license: "BSD-3-Clause",        tier: TIER.FREE },
      { name: "torchvision",             version: "0.26",      license: "BSD-3-Clause",        tier: TIER.FREE },
      { name: "Transformers (HF)",       version: "4.57",      license: "Apache-2.0",          tier: TIER.FREE },
      { name: "Pillow",                  version: "10.4",      license: "MIT-CMU (HPND)",      tier: TIER.FREE },
      { name: "pypdfium2 / PDFium",      version: "4.30",      license: "Apache-2.0 / BSD-3",  tier: TIER.FREE },
      { name: "pdftext",                 version: "0.6",       license: "Apache-2.0",          tier: TIER.FREE },
      { name: "NumPy",                   version: "2.4",       license: "BSD-3-Clause",        tier: TIER.FREE },
      { name: "OpenCV",                  version: "4.x",       license: "Apache-2.0",          tier: TIER.FREE },
      { name: "scikit-learn",            version: "1.9",       license: "BSD-3-Clause",        tier: TIER.FREE },
    ],
  },
  {
    key: "licenseGroupEngine",
    rows: [
      {
        name: "Marker (marker-pdf)",     version: "1.10.2",    license: "GPL-3.0", tier: TIER.PAID,
        note: "程式 GPL-3.0（開源，具 copyleft 義務）；模型權重商用受 Datalab 授權限制（前年營收/募資 > US$2M）。 · Code GPL-3.0 (copyleft); model weights need a Datalab commercial license above revenue/funding thresholds.",
      },
      {
        name: "Surya OCR (surya-ocr)",   version: "0.17.1",    license: "GPL-3.0", tier: TIER.PAID,
        note: "同 Marker，由 Datalab 提供；商用需 Datalab 授權。 · Same Datalab licensing as Marker.",
      },
      {
        name: "Ultralytics YOLO",        version: "8.3.x",     license: "AGPL-3.0", tier: TIER.PAID,
        note: "商業使用需 Ultralytics Enterprise License。 · Commercial use requires an Ultralytics Enterprise License.",
      },
    ],
  },
  {
    key: "licenseGroupModel",
    rows: [
      {
        name: "Surya / Datalab 模型權重 (detection · recognition · layout · table · ocr-error)",
        version: "2025", license: "OpenRAIL-M (modified)", tier: TIER.PAID,
        note: "商用受 Datalab 門檻限制，超過門檻須付費授權。 · Commercial use restricted by Datalab thresholds.",
      },
      {
        name: "YOLO Notes 模型 (notes_best.pt)",
        version: "自訓 / self-trained", license: "AGPL-3.0 (base)", tier: TIER.PAID,
        note: "自行訓練，衍生自 Ultralytics YOLOv8（AGPL-3.0）；商用授權依 Ultralytics。 · Self-trained on Ultralytics YOLOv8 (AGPL-3.0).",
      },
    ],
  },
];

const tierStyles = {
  paid:  "bg-error-container text-error dark:bg-[#93000a]/30 dark:text-[#ffb4ab] border-error/30",
  free:  "bg-primary/10 text-primary dark:bg-[#8D9965]/15 dark:text-[#b7c48c] border-primary/20",
};

const TierBadge = ({ tier, label }) => (
  <span className={`inline-block whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-label font-semibold border ${tierStyles[tier]}`}>
    {label}
  </span>
);

const LicensePage = ({ onBack }) => {
  const { t } = useT();
  const tierLabel = { paid: t.tierPaid, free: t.tierFree };

  const legend = [
    { tier: TIER.PAID,  label: t.tierPaid,  desc: t.tierPaidDesc },
    { tier: TIER.FREE,  label: t.tierFree,  desc: t.tierFreeDesc },
  ];

  return (
    <section className="flex-1 px-6 md:px-10 py-10 max-w-6xl mx-auto w-full">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-headline text-3xl md:text-4xl text-on-background dark:text-[#e5e2e1] font-semibold tracking-tight flex items-center gap-3">
            <span className="material-symbols-outlined text-primary dark:text-[#dcc497] text-[32px]">gavel</span>
            {t.licensePageTitle}
          </h1>
          <p className="mt-3 font-body text-on-surface-variant dark:text-[#cfc5b7] text-sm leading-relaxed max-w-3xl">
            {t.licenseIntro}
          </p>
        </div>
        <button
          onClick={onBack}
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t.licenseBack}
        </button>
      </div>

      {/* Legend */}
      <div className="mb-8 rounded-2xl border border-outline-variant dark:border-[#4c463c] bg-surface-container-low dark:bg-[#1c1b1b] p-5">
        <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] mb-3">
          {t.licenseLegendTitle}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {legend.map((l) => (
            <div key={l.tier} className="flex flex-col gap-1.5">
              <TierBadge tier={l.tier} label={l.label} />
              <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] leading-relaxed opacity-90">{l.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Component groups */}
      {GROUPS.map((group) => (
        <div key={group.key} className="mb-8">
          <h3 className="font-headline text-lg text-primary dark:text-[#dcc497] font-semibold mb-3">
            {t[group.key]}
          </h3>
          <div className="overflow-x-auto rounded-2xl border border-outline-variant dark:border-[#4c463c]">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-surface-container-high dark:bg-[#2a2a2a] text-left">
                  <th className="px-4 py-3 font-label font-semibold text-on-surface dark:text-[#e5e2e1]">{t.licenseColComponent}</th>
                  <th className="px-4 py-3 font-label font-semibold text-on-surface dark:text-[#e5e2e1] whitespace-nowrap">{t.licenseColVersion}</th>
                  <th className="px-4 py-3 font-label font-semibold text-on-surface dark:text-[#e5e2e1] whitespace-nowrap">{t.licenseColLicense}</th>
                  <th className="px-4 py-3 font-label font-semibold text-on-surface dark:text-[#e5e2e1] whitespace-nowrap">{t.licenseColCommercial}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, i) => (
                  <tr key={row.name} className={i % 2 ? "bg-surface-container-lowest dark:bg-[#181818]" : "bg-surface-container-low dark:bg-[#1c1b1b]"}>
                    <td className="px-4 py-3 align-top text-on-surface dark:text-[#e5e2e1]">
                      <span className="font-medium">{row.name}</span>
                      {row.note && (
                        <span className="block mt-1 text-[11px] leading-snug text-on-surface-variant dark:text-[#cfc5b7] opacity-80">
                          {row.note}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap font-mono text-xs text-on-surface-variant dark:text-[#cfc5b7]">{row.version}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-on-surface-variant dark:text-[#cfc5b7]">{row.license}</td>
                    <td className="px-4 py-3 align-top"><TierBadge tier={row.tier} label={tierLabel[row.tier]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Footnote + links */}
      <div className="mt-8 pt-6 border-t border-outline-variant dark:border-[#4c463c]">
        <p className="text-sm text-on-surface dark:text-[#e5e2e1] font-medium mb-3">
          ⚠ {t.licenseFootnote}
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="https://github.com/datalab-to/marker" target="_blank" rel="noreferrer"
             className="flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label text-on-surface dark:text-[#e5e2e1] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors">
            <span className="material-symbols-outlined text-[16px]">code</span>Marker (Datalab)
          </a>
          <a href="https://www.datalab.to/" target="_blank" rel="noreferrer"
             className="flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label text-on-surface dark:text-[#e5e2e1] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors">
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>Datalab licensing
          </a>
          <a href="https://www.ultralytics.com/license" target="_blank" rel="noreferrer"
             className="flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label text-on-surface dark:text-[#e5e2e1] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-colors">
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>Ultralytics license
          </a>
        </div>
      </div>
    </section>
  );
};

export default LicensePage;
