import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { wbDraw, wbFileUrl, wbSearch, wbStatus, wbUnderstand } from "../services/api";

// The back half of the 打線圖 mode. The OCR results arrive as props; each step
// below is one call to 圖衍析 through the backend proxy, and the netlist is
// kept in state between them so what gets searched for and drawn is exactly
// what the table shows. Nothing here draws — the layout rules live in 圖衍析.

const CARD = "rounded-3xl border border-outline-variant dark:border-[#4c463c] bg-surface-container-low dark:bg-[#1c1b1b] p-6";
const LABEL = "font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-70";
const INPUT = "px-3 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] bg-transparent text-sm font-body text-on-background dark:text-[#e5e2e1] min-w-0";
const BTN_PRIMARY = "flex items-center gap-2 rounded-full h-10 px-5 bg-primary dark:bg-[#dcc497] hover:opacity-90 disabled:opacity-40 text-on-primary dark:text-[#3d2e0e] text-sm font-bold transition-all shadow-md";
const BTN_QUIET = "flex items-center gap-2 rounded-full h-10 px-5 bg-surface-container-high dark:bg-[#2a2a2a] hover:bg-surface-container-highest dark:hover:bg-[#353534] text-on-surface dark:text-[#e5e2e1] text-sm font-bold transition-all";
const TH = "text-left font-label text-xs font-bold px-3 py-2 whitespace-nowrap text-on-surface-variant dark:text-[#cfc5b7]";
const TD = "px-3 py-1.5 font-body text-sm border-t border-outline-variant/40 dark:border-[#4c463c]/40";

const fmt = (v, d = 1) => (v == null ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));

const StepChip = ({ n, label, state }) => {
  const cls =
    state === "done"
      ? "bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e]"
      : state === "active"
        ? "border-2 border-primary dark:border-[#dcc497] text-primary dark:text-[#dcc497]"
        : "border border-outline-variant dark:border-[#4c463c] text-on-surface-variant dark:text-[#cfc5b7] opacity-60";
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${cls}`}>
        {state === "done" ? <span className="material-symbols-outlined text-[16px]">check</span> : n}
      </span>
      <span className={`font-label text-sm ${state === "pending" ? "opacity-60" : "font-semibold"}`}>{label}</span>
    </div>
  );
};

const WireBondResults = ({ results, onNewUpload }) => {
  const { t } = useT();

  const documents = useMemo(
    () =>
      results
        .filter((r) => r.success && (r.markdown_content || r.fastdoc_markdown))
        .map((r) => ({ filename: r.filename, markdown: r.markdown_content || r.fastdoc_markdown || "" })),
    [results],
  );

  const [status, setStatus] = useState(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hints, setHints] = useState({ product_code: "", customer: "", package_code: "" });

  const [busy, setBusy] = useState(null); // null | "read" | "search" | "draw"
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null); // { netlist, warnings, issues }
  const [matches, setMatches] = useState(null);
  const [referenceId, setReferenceId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [sheet, setSheet] = useState("png");

  useEffect(() => {
    let alive = true;
    wbStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      const names = Object.keys(s.providers || {});
      // Local first: Ollama needs no key and is what a plant will have.
      const first = names.includes("ollama") ? "ollama" : names[0] || "";
      setProvider(first);
      setModel(s.providers?.[first]?.default_model || s.providers?.[first]?.models?.[0] || "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const models = status?.providers?.[provider]?.models || [];
  const needsKey = provider && status?.providers?.[provider] && !status.providers[provider].configured;

  const run = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRead = () =>
    run("read", async () => {
      const res = await wbUnderstand(
        {
          provider,
          model,
          documents,
          product_code: hints.product_code.trim(),
          customer: hints.customer.trim(),
          package_code: hints.package_code.trim(),
          extra_texts: hints.package_code.trim() ? [hints.package_code.trim()] : [],
        },
        apiKey,
      );
      setRead(res);
      setMatches(null);
      setReferenceId(null);
      setDrawing(null);
    });

  const handleSearch = () =>
    run("search", async () => {
      const res = await wbSearch(read.netlist);
      setMatches(res.matches || []);
      setReferenceId(res.matches?.[0]?.record?.id ?? null);
      setDrawing(null);
    });

  const handleDraw = () =>
    run("draw", async () => {
      const res = await wbDraw(read.netlist, { referenceId, docNo: read.netlist.product_code || "" });
      setDrawing(res);
      setSheet("png");
    });

  const nl = read?.netlist;
  const wires = nl ? nl.pads.filter((p) => p.bond && p.ball_no).length : 0;
  const stepState = (i) => {
    const done = [true, Boolean(read), matches !== null, Boolean(drawing)];
    if (done[i]) return "done";
    const firstOpen = done.findIndex((d) => !d);
    return i === firstOpen ? "active" : "pending";
  };

  return (
    <section className="flex-1 px-6 md:px-10 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div className="space-y-1">
          <span className="text-primary dark:text-[#dcc497] font-label font-bold tracking-[0.2em] text-xs uppercase">
            {t.modeWirebond}
          </span>
          <h2 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter leading-tight">
            {t.wbHeading}
          </h2>
          <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body">
            {t.wbDocs(documents.length)}
            {" · "}
            {documents.map((d) => d.filename).join(", ")}
          </p>
        </div>
        <button onClick={onNewUpload} className={BTN_QUIET}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t.newBatch}
        </button>
      </div>

      {/* Steps */}
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <StepChip n={1} label={t.wbStepOcr} state={stepState(0)} />
        <StepChip n={2} label={t.wbStepRead} state={stepState(1)} />
        <StepChip n={3} label={t.wbStepSearch} state={stepState(2)} />
        <StepChip n={4} label={t.wbStepDraw} state={stepState(3)} />
      </div>

      {error && (
        <div className="p-4 bg-error-container dark:bg-[#93000a]/30 border border-error/30 rounded-2xl text-error dark:text-[#ffb4ab] text-sm">
          {error}
        </div>
      )}

      {/* 圖衍析 not available */}
      {status && !status.enabled && (
        <div className={`${CARD} text-sm text-on-surface-variant dark:text-[#cfc5b7]`}>{t.wbDisabled}</div>
      )}
      {status && status.enabled && !status.reachable && (
        <div className={`${CARD} text-sm text-on-surface-variant dark:text-[#cfc5b7]`}>
          {t.wbUnreachable(status.base_url)}
          {status.error && <div className="mt-2 opacity-70 font-mono text-xs">{status.error}</div>}
        </div>
      )}

      {/* Step 2: read */}
      {status?.reachable && (
        <div className={`${CARD} space-y-4`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t.wbEngine}</span>
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value;
                  setProvider(p);
                  setModel(status.providers[p]?.default_model || status.providers[p]?.models?.[0] || "");
                }}
                className={INPUT}
              >
                {Object.keys(status.providers).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t.wbModel}</span>
              <input list="wb-models" value={model} onChange={(e) => setModel(e.target.value)} className={INPUT} />
              <datalist id="wb-models">
                {models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </label>
            {needsKey && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t.wbApiKey}</span>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={INPUT} autoComplete="off" />
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ["product_code", t.wbProductCode, "316D"],
              ["customer", t.wbCustomer, "ESMT"],
              ["package_code", t.wbPackageCode, t.wbPackageHint],
            ].map(([k, label, ph]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className={LABEL}>{label}</span>
                <input
                  value={hints[k]}
                  placeholder={ph}
                  onChange={(e) => setHints((h) => ({ ...h, [k]: e.target.value }))}
                  className={INPUT}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRead}
              disabled={busy !== null || !documents.length || !provider || !model || (needsKey && !apiKey)}
              className={BTN_PRIMARY}
            >
              <span className={`material-symbols-outlined text-[18px] ${busy === "read" ? "animate-spin" : ""}`}>
                {busy === "read" ? "sync" : "psychology"}
              </span>
              {busy === "read" ? t.wbReading : read ? t.wbReadAgain : t.wbRead}
            </button>
          </div>
        </div>
      )}

      {/* Netlist as read */}
      {nl && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-headline text-2xl font-semibold text-on-background dark:text-[#e5e2e1]">
              {nl.product_code || "—"}{nl.customer ? ` · ${nl.customer}` : ""}
            </h3>
            <span className="text-sm text-on-surface-variant dark:text-[#cfc5b7]">{t.wbPads(nl.pads.length, wires)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className={LABEL}>{t.wbDie}</div>
              <div className="font-mono">{fmt(nl.die.width_um, 0)} × {fmt(nl.die.height_um, 0)} µm</div>
              <div className="font-mono opacity-70">pad {fmt(nl.die.pad_size_um, 0)} µm · scribe {fmt(nl.die.scribe_um, 0)} µm</div>
            </div>
            <div>
              <div className={LABEL}>{t.wbPackage}</div>
              <div className="font-mono">
                {nl.package_code || nl.package.family} · {fmt(nl.package.body_w_mm)}×{fmt(nl.package.body_h_mm)}{nl.package.thickness_mm != null ? `×${fmt(nl.package.thickness_mm)}` : ""} mm
              </div>
              <div className="font-mono opacity-70">{nl.package.ball_cols}×{nl.package.ball_rows} balls · P{fmt(nl.package.pitch_mm, 2)}</div>
            </div>
            <div>
              <div className={LABEL}>{t.wbWafer}</div>
              {nl.wafer ? (
                <div className="font-mono text-xs leading-5">
                  {nl.wafer.wafer_size_inch != null && <div>{nl.wafer.wafer_size_inch}" · {nl.wafer.fab || "—"} · {nl.wafer.process_nm != null ? `${nl.wafer.process_nm}nm` : ""}</div>}
                  {nl.wafer.al_pad_stack && <div>{nl.wafer.al_pad_stack}</div>}
                  {nl.wafer.passivation && <div>{nl.wafer.passivation}{nl.wafer.metal_layers != null ? ` · ${nl.wafer.metal_layers}M` : ""}</div>}
                </div>
              ) : (
                <div className="opacity-60">—</div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-outline-variant dark:border-[#4c463c]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-container-high dark:bg-[#2a2a2a]">
                  <th className={TH}>{t.wbColNo}</th>
                  <th className={TH}>{t.wbColName}</th>
                  <th className={TH}>X (µm)</th>
                  <th className={TH}>Y (µm)</th>
                  <th className={TH}>{t.wbColType}</th>
                  <th className={TH}>{t.wbColBall}</th>
                  <th className={TH}>{t.wbColBond}</th>
                </tr>
              </thead>
              <tbody>
                {[...nl.pads].sort((a, b) => a.no - b.no).map((p) => (
                  <tr key={p.no} className={p.bond ? "" : "opacity-50"}>
                    <td className={`${TD} font-mono`}>{p.no}</td>
                    <td className={TD}>{p.name}{p.ball_name && p.ball_name !== p.name ? <span className="opacity-60"> / {p.ball_name}</span> : null}</td>
                    <td className={`${TD} font-mono`}>{fmt(p.x_um, 1)}</td>
                    <td className={`${TD} font-mono`}>{fmt(p.y_um, 1)}</td>
                    <td className={TD}>{p.pad_type}</td>
                    <td className={`${TD} font-mono`}>{p.ball_no || "NC"}</td>
                    <td className={TD}>
                      <span className="material-symbols-outlined text-[16px]">{p.bond ? "check" : "close"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(read.issues?.length > 0 || read.warnings?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {read.issues?.length > 0 && (
                <div>
                  <div className={LABEL}>{t.wbIssues}</div>
                  <ul className="list-disc pl-5 space-y-0.5 mt-1 text-on-surface-variant dark:text-[#cfc5b7]">
                    {read.issues.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {read.warnings?.length > 0 && (
                <div>
                  <div className={LABEL}>{t.wbWarnings}</div>
                  <ul className="list-disc pl-5 space-y-0.5 mt-1 text-error dark:text-[#ffb4ab]">
                    {read.warnings.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={handleSearch} disabled={busy !== null} className={BTN_PRIMARY}>
              <span className={`material-symbols-outlined text-[18px] ${busy === "search" ? "animate-spin" : ""}`}>
                {busy === "search" ? "sync" : "manage_search"}
              </span>
              {busy === "search" ? t.wbSearching : t.wbSearch}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: matches */}
      {matches && (
        <div className={`${CARD} space-y-4`}>
          <div className={LABEL}>{t.wbReference}</div>
          {matches.length === 0 && <div className="text-sm opacity-70">{t.wbNoMatches}</div>}
          <div className="space-y-2">
            {matches.map((m) => {
              const r = m.record;
              const active = referenceId === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setReferenceId(r.id)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                    active
                      ? "border-primary dark:border-[#dcc497] bg-primary/5 dark:bg-[#dcc497]/10"
                      : "border-outline-variant dark:border-[#4c463c] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono font-bold">{r.id}</span>
                    <span className="text-sm opacity-80">{r.product_code} · {r.package}</span>
                    {r.synthetic && (
                      <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-outline-variant dark:border-[#4c463c] opacity-70">
                        {t.wbSynthetic}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-sm">{Math.round(m.score * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-container-high dark:bg-[#2a2a2a] overflow-hidden">
                    <div className="h-full bg-primary dark:bg-[#dcc497]" style={{ width: `${Math.round(m.score * 100)}%` }} />
                  </div>
                  {m.reasons?.length > 0 && (
                    <div className="mt-1.5 text-xs opacity-70">{m.reasons.slice(0, 4).join(" · ")}</div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleDraw} disabled={busy !== null} className={BTN_PRIMARY}>
              <span className={`material-symbols-outlined text-[18px] ${busy === "draw" ? "animate-spin" : ""}`}>
                {busy === "draw" ? "sync" : "draw"}
              </span>
              {busy === "draw" ? t.wbDrawing : t.wbDraw}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: drawing */}
      {drawing && (
        <div className={`${CARD} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={LABEL}>{t.wbSheets}</div>
              <div className="text-sm mt-1">{t.wbStats(drawing.stats)}</div>
              {drawing.reference && (
                <div className="text-xs opacity-70 mt-0.5">{t.wbReference}: {drawing.reference.id}</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {["pdf", "dwg", "dxf"].filter((k) => drawing.files?.[k]).map((k) => (
                <a
                  key={k}
                  href={wbFileUrl(drawing.job_id, k)}
                  download
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-xs font-label font-semibold hover:opacity-90 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  {k.toUpperCase()}
                </a>
              ))}
            </div>
          </div>

          {drawing.warnings?.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-error dark:text-[#ffb4ab] space-y-0.5">
              {drawing.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <div className="flex gap-2">
            {[["png", "1 BONDING"], ["png2", "2 PADS"], ["png3", "3 BALL MAP"]].filter(([k]) => drawing.files?.[k]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSheet(k)}
                className={`px-3 py-1 rounded-full text-xs font-label border transition-colors ${
                  sheet === k
                    ? "border-primary dark:border-[#dcc497] text-primary dark:text-[#dcc497] font-semibold"
                    : "border-outline-variant dark:border-[#4c463c] opacity-70 hover:opacity-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {drawing.files?.[sheet] && (
            <img
              src={wbFileUrl(drawing.job_id, sheet)}
              alt={sheet}
              className="w-full rounded-2xl border border-outline-variant dark:border-[#4c463c] bg-white"
            />
          )}
        </div>
      )}
    </section>
  );
};

export default WireBondResults;
