import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  deleteErpJob,
  erpExportUrl,
  erpPageUrl,
  getErpJob,
  getErpLlm,
  getErpSchema,
  listErpJobs,
  mapErpBatch,
  mapErpJob,
  putErpRows,
  setErpReviewed,
  teachFromErpJob,
} from "../services/api";

// How often to re-check whether 知識通 has posted rows back. The work happens
// in another system on a human's timescale, so this is a courtesy refresh, not
// a progress bar — slow enough to be free, fast enough that nobody reaches for
// the button.
const POLL_MS = 5000;

// The three limit/unit columns hold short tokens ("%", "40", "min"); the other
// four hold the text a reviewer actually reads. Sizing them equally pushed the
// last column off a 1440px screen.
const COL_WIDTH = {
  supplier_lot: "min-w-[7rem]",
  test_item: "min-w-[9rem]",
  unit: "min-w-[3.5rem]",
  spec: "min-w-[9rem]",
  spec_max: "min-w-[4.5rem]",
  spec_min: "min-w-[4.5rem]",
  result: "min-w-[8rem]",
};

const STATUS_STYLES = {
  pending: "bg-tertiary/10 dark:bg-[#dcc497]/10 text-tertiary dark:text-[#dcc497]",
  mapped: "bg-primary/10 dark:bg-[#dcc497]/15 text-primary dark:text-[#dcc497]",
  failed: "bg-error-container dark:bg-[#93000a]/30 text-error dark:text-[#ffb4ab]",
};

// Rendered page width in CSS pixels at 100%. The backend renders to the same
// number, so a page at 100% is pixel-for-pixel rather than a browser upscale.
const BASE_PAGE_WIDTH = 1400;
const ZOOM_STEPS = [1, 1.5, 2];

const PILL =
  "px-4 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] " +
  "text-xs font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all";
const PILL_FILLED =
  "px-4 py-1.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary " +
  "dark:text-[#3d2e0e] text-xs font-label font-semibold hover:opacity-90 transition-all";

/**
 * The source document, one rendered page under another.
 *
 * Images rather than an embedded PDF viewer: the app's CSP sets
 * `object-src 'none'` and `frame-ancestors 'none'`, so an iframe or embed
 * holding a PDF is blocked even same-origin. Rendering server-side also suits
 * the material — most of these COAs are scans, so there was never a text layer
 * to select — and it gives page numbers to hang a future "jump to this row's
 * page" off.
 */
const PdfPane = ({ jobId, pageCount, t }) => {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState({});

  // Reset when the reviewer moves to another report, or a long scan leaves the
  // pane scrolled and magnified over the next one-page document.
  useEffect(() => {
    setZoom(1);
    setFailed({});
  }, [jobId]);

  const zoomIdx = ZOOM_STEPS.indexOf(zoom);
  const width = Math.round(BASE_PAGE_WIDTH * zoom);
  const pageNos = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="rounded-2xl border border-outline-variant dark:border-[#4c463c] overflow-hidden flex flex-col">
      <div className="flex items-center justify-end gap-1 px-3 py-2 bg-surface-container-high dark:bg-[#2a2a2a]">
        <button
          onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIdx - 1)])}
          disabled={zoomIdx <= 0}
          aria-label={t.erpZoomOut}
          className="w-7 h-7 rounded-full grid place-items-center hover:bg-surface-container-low dark:hover:bg-[#1c1b1b] disabled:opacity-30 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out</span>
        </button>
        <span className="text-[11px] font-mono w-10 text-center text-on-surface-variant dark:text-[#cfc5b7]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIdx + 1)])}
          disabled={zoomIdx >= ZOOM_STEPS.length - 1}
          aria-label={t.erpZoomIn}
          className="w-7 h-7 rounded-full grid place-items-center hover:bg-surface-container-low dark:hover:bg-[#1c1b1b] disabled:opacity-30 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
        </button>
      </div>

      {/* Fixed height so the table beside it stays put while the page scrolls. */}
      <div className="overflow-auto custom-scrollbar bg-surface-container-low dark:bg-[#1c1b1b] h-[70vh] p-3 space-y-4">
        {pageNos.map((n) => (
          <figure key={n} className="space-y-1">
            <figcaption className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-50">
              {t.erpPageOf(n, pageCount)}
            </figcaption>
            {failed[n] ? (
              <p className="text-xs text-error dark:text-[#ffb4ab] py-4">{t.erpPageFailed}</p>
            ) : (
              <img
                src={erpPageUrl(jobId, n, width)}
                alt={t.erpPageOf(n, pageCount)}
                loading="lazy"
                onError={() => setFailed((f) => ({ ...f, [n]: true }))}
                style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                className="rounded-lg shadow-sm bg-white"
              />
            )}
          </figure>
        ))}
      </div>
    </div>
  );
};

const ErpResults = ({ batchId, onNewUpload }) => {
  const { t } = useT();

  const [jobs, setJobs] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draftRows, setDraftRows] = useState(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [splitView, setSplitView] = useState(true);
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Mapping engine. "manual" is 知識通 — the one the backend cannot push work
  // into, so it gets the copy-this-instruction card instead of a button.
  const [llmInfo, setLlmInfo] = useState(null);
  const [engine, setEngine] = useState("manual");
  const [model, setModel] = useState("");
  const [mapping, setMapping] = useState(false);
  const [taught, setTaught] = useState(false);

  // Keeps the poll from stomping on a half-typed correction.
  const editingRef = useRef(false);
  editingRef.current = draftRows !== null;

  useEffect(() => {
    // A deployment with ERP_LLM_PROVIDERS unset gets no picker at all and the
    // page behaves exactly as it did before — 知識通 over MCP, by hand.
    getErpLlm()
      .then((d) => {
        setLlmInfo(d);
        const first = Object.entries(d.providers || {}).find(([, p]) => p.enabled && p.configured);
        if (d.enabled && first) {
          setEngine(first[0]);
          setModel(first[1].default_model || "");
        }
      })
      .catch(() => setLlmInfo(null));
  }, []);

  // The batch's own profile decides the table's columns, so it is read off a
  // job rather than defaulted — a customer whose template is not the built-in
  // seven would otherwise be shown the wrong headers over the right values.
  const profileId = jobs[0]?.profile_id || "default";

  useEffect(() => {
    getErpSchema(profileId)
      .then((s) => setColumns(s.columns || []))
      .catch((e) => setError(e.message));
  }, [profileId]);

  const refresh = useCallback(async () => {
    try {
      const { jobs: next } = await listErpJobs({ batchId });
      setJobs(next);
      setError(null);
      setSelectedId((cur) => cur ?? next.find((j) => j.status === "mapped")?.job_id ?? null);
    } catch (e) {
      setError(e.message);
    }
  }, [batchId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Load the selected job's rows. Skipped while a correction is in flight so a
  // poll cannot discard what the reviewer is typing.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getErpJob(selectedId, { includeMarkdown: true })
      .then((d) => {
        if (cancelled || editingRef.current) return;
        setDetail(d);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // jobs is in the deps so a job flipping to `mapped` pulls its rows in.
  }, [selectedId, jobs]);

  const pending = jobs.filter((j) => j.status === "pending");
  const mapped = jobs.filter((j) => j.status === "mapped");
  const reviewed = mapped.filter((j) => j.reviewed_at);
  const unreviewed = mapped.filter((j) => !j.reviewed_at);
  const exportIds = (includeUnreviewed ? mapped : reviewed).map((j) => j.job_id);
  // Nothing left waiting on 知識通 — the page is a review sheet now, not a queue.
  const allDone = jobs.length > 0 && pending.length === 0;

  // The list is the source of truth for the sign-off and the page count:
  // `detail` is only refetched when the selection or the poll changes, so it
  // goes stale the moment the reviewer clicks Confirm.
  const selectedJob = jobs.find((j) => j.job_id === selectedId) || null;
  const isReviewed = Boolean(selectedJob?.reviewed_at);
  const hasSource = Boolean(selectedJob?.has_source && selectedJob?.page_count > 0);

  const instruction = useMemo(
    () => t.erpInstructionBody(pending.length || jobs.length),
    [t, pending.length, jobs.length]
  );

  const copyInstruction = () => {
    navigator.clipboard.writeText(instruction);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Only engines this deployment turned on *and* has credentials for. An
  // engine that would fail on every call has no business in the picker.
  const engines = Object.entries(llmInfo?.providers || {})
    .filter(([, p]) => p.enabled && p.configured)
    .map(([name, p]) => ({ name, ...p }));
  const currentEngine = engines.find((e) => e.name === engine) || null;

  const selectEngine = (name) => {
    setEngine(name);
    setModel(engines.find((e) => e.name === name)?.default_model || "");
  };

  // Returns as soon as the work is queued — the poll above is what reports
  // progress, one job at a time, as each one lands.
  const startMapping = async () => {
    setMapping(true);
    try {
      await mapErpBatch({ batchId, provider: engine, model });
      setError(null);
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setMapping(false);
    }
  };

  const retryMapping = async (jobId) => {
    try {
      await mapErpJob(jobId, { provider: engine, model });
      setError(null);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const rows = draftRows ?? detail?.rows ?? [];
  const blankRow = () => Object.fromEntries(columns.map((c) => [c.key, ""]));
  const mutateRows = (fn) => setDraftRows((cur) => fn(cur ?? detail?.rows ?? []));

  const editCell = (rowIdx, key, value) =>
    mutateRows((base) => base.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));

  const addRow = () => mutateRows((base) => [...base, blankRow()]);

  const duplicateRow = (rowIdx) =>
    mutateRows((base) => [
      ...base.slice(0, rowIdx + 1),
      { ...base[rowIdx] },
      ...base.slice(rowIdx + 1),
    ]);

  const deleteRow = (rowIdx) => mutateRows((base) => base.filter((_, i) => i !== rowIdx));

  const saveRows = async () => {
    if (!draftRows || !selectedId) return;
    try {
      const d = await putErpRows(selectedId, draftRows, { mappedBy: "人工覆核" });
      setDetail((cur) => ({ ...cur, ...d }));
      setDraftRows(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // Saving rows clears any earlier sign-off on the backend, so what a reviewer
  // confirms is always what is actually stored.
  const toggleReviewed = async () => {
    if (!selectedId) return;
    try {
      await setErpReviewed(selectedId, !isReviewed);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  // The corrections a reviewer just made are the same evidence a training
  // sample carries — this document, and the answer a person settled on. Today
  // they evaporate when the job is pruned; this keeps them.
  const keepAsSample = async () => {
    if (!selectedId) return;
    try {
      await teachFromErpJob(selectedId);
      setTaught(true);
      setTimeout(() => setTaught(false), 2200);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const discard = async (jobId) => {
    try {
      await deleteErpJob(jobId);
      if (jobId === selectedId) {
        setSelectedId(null);
        setDraftRows(null);
      }
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const statusLabel = {
    pending: t.erpStatusPending,
    mapped: t.erpStatusMapped,
    failed: t.erpStatusFailed,
  };

  const reviewTable = (
    <div className="min-w-0">
      {rows.length > 0 ? (
        <>
          {/* Wide table: scrolls inside its own box so the page never scrolls
              sideways. */}
          <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-outline-variant dark:border-[#4c463c]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-container-high dark:bg-[#2a2a2a]">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="text-left font-label text-xs font-bold px-3 py-2.5 whitespace-nowrap text-on-surface-variant dark:text-[#cfc5b7]"
                    >
                      {c.name}
                      {c.required && (
                        <span className="text-error dark:text-[#ffb4ab] ml-0.5">*</span>
                      )}
                    </th>
                  ))}
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-t border-outline-variant dark:border-[#4c463c] group"
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-1.5 py-1">
                        <input
                          value={row[c.key] ?? ""}
                          onChange={(e) => editCell(i, c.key, e.target.value)}
                          className={`w-full bg-transparent px-2 py-1.5 rounded-lg text-on-background dark:text-[#e5e2e1] focus:bg-surface-container-high dark:focus:bg-[#2a2a2a] focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-[#dcc497] ${
                            COL_WIDTH[c.key] || "min-w-[7rem]"
                          }`}
                        />
                      </td>
                    ))}
                    {/* Row actions: a reviewer who spots a test item the mapper
                        missed has to be able to add it, and a scan artefact
                        read as a row has to be removable. */}
                    <td className="px-1.5 py-1 whitespace-nowrap">
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={() => duplicateRow(i)}
                          aria-label={t.erpDuplicateRow}
                          title={t.erpDuplicateRow}
                          className="w-7 h-7 rounded-full grid place-items-center text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            content_copy
                          </span>
                        </button>
                        <button
                          onClick={() => deleteRow(i)}
                          aria-label={t.erpDeleteRow}
                          title={t.erpDeleteRow}
                          className="w-7 h-7 rounded-full grid place-items-center text-error dark:text-[#ffb4ab] hover:bg-error-container dark:hover:bg-[#93000a]/30"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-dashed border-outline-variant dark:border-[#4c463c] text-xs font-label text-on-surface-variant dark:text-[#cfc5b7] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t.erpAddRow}
          </button>
        </>
      ) : (
        <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70 py-6">
          {detail?.status === "failed" ? detail.error : t.erpStatusPending}
        </p>
      )}
    </div>
  );

  return (
    <section className="flex-1 px-6 md:px-10 py-10">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div className="space-y-1">
          <span className="text-primary dark:text-[#dcc497] font-label font-bold tracking-[0.2em] text-xs uppercase">
            {t.modeErp}
          </span>
          <h2 className="font-headline text-4xl md:text-5xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter leading-tight">
            {allDone ? t.erpReviewHeading : t.erpQueueHeading}
          </h2>
          <p className="text-on-surface-variant dark:text-[#cfc5b7] text-sm font-body max-w-2xl">
            {allDone ? t.erpReviewDesc(mapped.length) : t.erpQueueDesc(jobs.length)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-label text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
            <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
            {t.erpAuto}
          </span>
          <button
            onClick={refresh}
            className="px-4 py-2 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all"
          >
            {t.erpRefresh}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container dark:bg-[#93000a]/30 border border-error/30 rounded-2xl text-error dark:text-[#ffb4ab] text-sm">
          {error}
        </div>
      )}

      {/* How the pending queue gets mapped. The backend can drive a local or
          company model itself; 知識通 is the option it cannot push work into,
          so that one is a copy-this-instruction card rather than a button. */}
      {pending.length > 0 && (
        <div className="mb-8 rounded-3xl border border-outline-variant dark:border-[#4c463c] bg-surface-container-low dark:bg-[#1c1b1b] p-6 space-y-4">
          {engines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                {t.erpEngine}
              </span>
              <select
                value={engine}
                onChange={(e) => selectEngine(e.target.value)}
                className="px-3 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] bg-transparent text-xs font-label text-on-background dark:text-[#e5e2e1]"
              >
                {engines.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name === "ollama" ? t.erpEngineOllama : t.erpEngineGateway}
                  </option>
                ))}
                <option value="manual">{t.erpEngineManual}</option>
              </select>

              {currentEngine && (
                <>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="px-3 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] bg-transparent text-xs font-mono text-on-background dark:text-[#e5e2e1] max-w-[16rem]"
                  >
                    {currentEngine.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={startMapping}
                    disabled={mapping}
                    className={`flex items-center gap-1.5 disabled:opacity-40 ${PILL_FILLED}`}
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] ${mapping ? "animate-spin" : ""}`}
                    >
                      {mapping ? "sync" : "play_arrow"}
                    </span>
                    {mapping ? t.erpMapping : t.erpMappingN(pending.length)}
                  </button>
                </>
              )}
            </div>
          )}

          {currentEngine?.error && (
            <p className="text-xs text-tertiary dark:text-[#dcc497]">{t.erpEngineOffline}</p>
          )}
          {engine === "ollama" && (
            <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
              {t.erpEngineCaveat}
            </p>
          )}

          {/* The handoff to 知識通: the backend cannot push work into it, a
              person has to go and ask. */}
          {!currentEngine && (
            <>
              <div className="flex items-center justify-between gap-4">
                <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                  {t.erpInstruction}
                </span>
                <button
                  onClick={copyInstruction}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-xs font-label font-semibold hover:opacity-90 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied ? "check" : "content_copy"}
                  </span>
                  {copied ? t.erpCopied : t.erpCopy}
                </button>
              </div>
              <p className="font-mono text-sm text-on-background dark:text-[#e5e2e1] bg-surface-container-high dark:bg-[#2a2a2a] rounded-xl px-4 py-3">
                {instruction}
              </p>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* ── Job list ──────────────────────────────────────────────────── */}
        <div className="space-y-2">
          {jobs.length === 0 && (
            <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70 py-6">
              {t.erpEmpty}
            </p>
          )}
          {jobs.map((j) => (
            <div key={j.job_id} className="space-y-1">
              <button
                onClick={() => {
                  setSelectedId(j.job_id);
                  setDraftRows(null);
                  setShowMarkdown(false);
                }}
                className={`w-full text-left rounded-2xl px-4 py-3 border transition-all ${
                  selectedId === j.job_id
                    ? "border-primary dark:border-[#dcc497] bg-surface-container-low dark:bg-[#1c1b1b]"
                    : "border-outline-variant dark:border-[#4c463c] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
                }`}
              >
                <p className="text-sm font-semibold truncate text-on-background dark:text-[#e5e2e1]">
                  {j.filename}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-label font-bold ${
                      STATUS_STYLES[j.status] || ""
                    }`}
                  >
                    {j.mapping_state === "running"
                      ? t.erpMapping
                      : statusLabel[j.status] || j.status}
                  </span>
                  {j.mapping_state === "running" && (
                    <span className="material-symbols-outlined text-[13px] animate-spin text-tertiary dark:text-[#dcc497]">
                      sync
                    </span>
                  )}
                  {j.reviewed_at && (
                    <span className="flex items-center gap-0.5 text-[10px] font-label font-bold text-primary dark:text-[#dcc497]">
                      <span className="material-symbols-outlined text-[13px]">task_alt</span>
                      {t.erpConfirmed}
                    </span>
                  )}
                  {j.row_count > 0 && (
                    <span className="text-[11px] text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                      {t.erpRows(j.row_count)}
                    </span>
                  )}
                </div>
                {j.error && (
                  <p className="text-[11px] text-error dark:text-[#ffb4ab] mt-1.5">{j.error}</p>
                )}
                {j.mapping_state === "error" && (
                  <p className="text-[11px] text-error dark:text-[#ffb4ab] mt-1.5">
                    {t.erpMapFailed}：{j.mapping_error}
                  </p>
                )}
              </button>

              {/* Sibling, not nested: a control inside a <button> is neither
                valid HTML nor reachable by keyboard. A model that could not be
                reached is not a broken document — the job is still pending, so
                offer the run again rather than making anyone re-upload. */}
              {j.mapping_state === "error" && currentEngine && (
                <button
                  onClick={() => retryMapping(j.job_id)}
                  className="text-[11px] font-label underline text-primary dark:text-[#dcc497] px-4"
                >
                  {t.erpRetryMap}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* ── Review pane ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          {!detail && (
            <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70 py-6">
              {t.erpEmpty}
            </p>
          )}

          {detail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="font-headline text-xl text-on-background dark:text-[#e5e2e1] font-semibold truncate">
                  {detail.filename}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {draftRows && (
                    <>
                      <span className="text-xs font-label text-tertiary dark:text-[#dcc497]">
                        {t.erpUnsaved}
                      </span>
                      <button onClick={saveRows} className={PILL_FILLED}>
                        {t.erpSaveRow}
                      </button>
                    </>
                  )}
                  {saved && (
                    <span className="text-xs font-label text-primary dark:text-[#dcc497]">
                      {t.erpSaved}
                    </span>
                  )}
                  {hasSource && (
                    <button onClick={() => setSplitView((v) => !v)} className={PILL}>
                      {splitView ? t.erpHidePdf : t.erpShowPdf}
                    </button>
                  )}
                  <button onClick={() => setShowMarkdown((v) => !v)} className={PILL}>
                    {t.erpViewMarkdown}
                  </button>
                  {/* Sign-off sits beside the rows it covers, not on the export
                      bar — it is a statement about this one report. */}
                  {detail.status === "mapped" && (
                    <button
                      onClick={toggleReviewed}
                      disabled={Boolean(draftRows)}
                      title={draftRows ? t.erpConfirmHint : undefined}
                      className={`flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                        isReviewed ? PILL : PILL_FILLED
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isReviewed ? "undo" : "task_alt"}
                      </span>
                      {isReviewed ? t.erpUnconfirm : t.erpConfirm}
                    </button>
                  )}
                  {isReviewed && (
                    <button
                      onClick={keepAsSample}
                      title={t.erpKeepHint}
                      className={`flex items-center gap-1.5 ${PILL}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {taught ? "check" : "school"}
                      </span>
                      {taught ? t.erpKeptAsSample : t.erpKeepAsSample}
                    </button>
                  )}
                  <button
                    onClick={() => discard(detail.job_id)}
                    className={`${PILL} text-error dark:text-[#ffb4ab]`}
                  >
                    {t.erpDiscard}
                  </button>
                </div>
              </div>

              {detail.notes && (
                <div className="mb-4 rounded-2xl bg-tertiary/10 dark:bg-[#dcc497]/10 px-4 py-3">
                  <span className="font-label text-[10px] uppercase tracking-widest text-tertiary dark:text-[#dcc497] font-bold">
                    {t.erpNotesFrom}
                  </span>
                  <p className="text-sm text-on-background dark:text-[#e5e2e1] mt-1">
                    {detail.notes}
                  </p>
                </div>
              )}

              {!hasSource && detail.status === "mapped" && (
                <p className="mb-4 text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                  {t.erpNoSource}
                </p>
              )}

              {showMarkdown && (
                <pre className="mb-4 max-h-80 overflow-auto custom-scrollbar rounded-2xl bg-surface-container-high dark:bg-[#2a2a2a] p-4 text-xs font-mono whitespace-pre-wrap text-on-surface-variant dark:text-[#cfc5b7]">
                  {detail.markdown}
                </pre>
              )}

              {/* Side by side above 1280px, stacked below: two half-width panes
                  on a laptop are two unreadable panes. */}
              {hasSource && splitView ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                  <PdfPane jobId={detail.job_id} pageCount={selectedJob?.page_count || 1} t={t} />
                  {reviewTable}
                </div>
              ) : (
                reviewTable
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Export ────────────────────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-outline-variant dark:border-[#4c463c] flex flex-wrap items-center gap-3">
        {mapped.length > 0 ? (
          <>
            <a
              href={
                exportIds.length
                  ? erpExportUrl(exportIds, "xlsx", { onlyReviewed: !includeUnreviewed })
                  : undefined
              }
              aria-disabled={exportIds.length === 0}
              className={`px-5 py-2.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-sm font-label font-semibold transition-all flex items-center gap-2 ${
                exportIds.length ? "hover:opacity-90" : "opacity-40 pointer-events-none"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {t.erpExportXlsx}
            </a>
            <a
              href={
                exportIds.length
                  ? erpExportUrl(exportIds, "csv", { onlyReviewed: !includeUnreviewed })
                  : undefined
              }
              aria-disabled={exportIds.length === 0}
              className={`px-5 py-2.5 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label transition-all ${
                exportIds.length
                  ? "hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
                  : "opacity-40 pointer-events-none"
              }`}
            >
              {t.erpExportCsv}
            </a>

            <span className="text-xs font-label text-on-surface-variant dark:text-[#cfc5b7]">
              {t.erpExportCount(reviewed.length, unreviewed.length)}
            </span>

            {unreviewed.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs font-label text-on-surface-variant dark:text-[#cfc5b7] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnreviewed}
                  onChange={(e) => setIncludeUnreviewed(e.target.checked)}
                  className="accent-primary dark:accent-[#dcc497]"
                />
                {t.erpIncludeUnreviewed}
              </label>
            )}

            <span className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-60">
              {exportIds.length === 0 ? t.erpNothingReviewed : t.erpExportHint}
            </span>
          </>
        ) : (
          <span className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
            {t.erpNothingMapped}
          </span>
        )}

        <button
          onClick={onNewUpload}
          className="ml-auto px-5 py-2.5 rounded-full bg-secondary dark:bg-[#c6c6c6] text-on-secondary dark:text-[#131313] text-sm font-label font-semibold hover:opacity-90 transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t.newBatch}
        </button>
      </div>
    </section>
  );
};

export default ErpResults;
