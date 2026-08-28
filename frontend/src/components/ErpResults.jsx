import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  deleteErpJob,
  erpExportUrl,
  getErpJob,
  getErpSchema,
  listErpJobs,
  putErpRows,
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

const ErpResults = ({ batchId, onNewUpload }) => {
  const { t } = useT();

  const [jobs, setJobs] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draftRows, setDraftRows] = useState(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Keeps the poll from stomping on a half-typed correction.
  const editingRef = useRef(false);
  editingRef.current = draftRows !== null;

  useEffect(() => {
    getErpSchema()
      .then((s) => setColumns(s.columns || []))
      .catch((e) => setError(e.message));
  }, []);

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
  const mappedIds = mapped.map((j) => j.job_id);
  // Nothing left waiting on 知識通 — the page is a review sheet now, not a queue.
  const allDone = jobs.length > 0 && pending.length === 0;

  const instruction = useMemo(
    () => t.erpInstructionBody(pending.length || jobs.length),
    [t, pending.length, jobs.length],
  );

  const copyInstruction = () => {
    navigator.clipboard.writeText(instruction);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const rows = draftRows ?? detail?.rows ?? [];

  const editCell = (rowIdx, key, value) => {
    setDraftRows((cur) => {
      const base = cur ?? detail?.rows ?? [];
      return base.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r));
    });
  };

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

      {/* The instruction to paste into 知識通. This is the handoff: the backend
          cannot push work into 知識通, a person has to ask it. */}
      {pending.length > 0 && (
        <div className="mb-8 rounded-3xl border border-outline-variant dark:border-[#4c463c] bg-surface-container-low dark:bg-[#1c1b1b] p-6">
          <div className="flex items-center justify-between gap-4 mb-3">
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
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ── Job list ──────────────────────────────────────────────────── */}
        <div className="space-y-2">
          {jobs.length === 0 && (
            <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70 py-6">
              {t.erpEmpty}
            </p>
          )}
          {jobs.map((j) => (
            <button
              key={j.job_id}
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
              <div className="flex items-center gap-2 mt-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-label font-bold ${
                    STATUS_STYLES[j.status] || ""
                  }`}
                >
                  {statusLabel[j.status] || j.status}
                </span>
                {j.row_count > 0 && (
                  <span className="text-[11px] text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                    {t.erpRows(j.row_count)}
                  </span>
                )}
              </div>
              {j.error && (
                <p className="text-[11px] text-error dark:text-[#ffb4ab] mt-1.5">{j.error}</p>
              )}
            </button>
          ))}
        </div>

        {/* ── Review table ──────────────────────────────────────────────── */}
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
                <div className="flex items-center gap-2">
                  {draftRows && (
                    <button
                      onClick={saveRows}
                      className="px-4 py-1.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-xs font-label font-semibold hover:opacity-90 transition-all"
                    >
                      {t.erpSaveRow}
                    </button>
                  )}
                  {saved && (
                    <span className="text-xs font-label text-primary dark:text-[#dcc497]">
                      {t.erpSaved}
                    </span>
                  )}
                  <button
                    onClick={() => setShowMarkdown((v) => !v)}
                    className="px-4 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] text-xs font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all"
                  >
                    {t.erpViewMarkdown}
                  </button>
                  <button
                    onClick={() => discard(detail.job_id)}
                    className="px-4 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] text-xs font-label text-error dark:text-[#ffb4ab] hover:bg-error-container dark:hover:bg-[#93000a]/30 transition-all"
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

              {showMarkdown && (
                <pre className="mb-4 max-h-80 overflow-auto custom-scrollbar rounded-2xl bg-surface-container-high dark:bg-[#2a2a2a] p-4 text-xs font-mono whitespace-pre-wrap text-on-surface-variant dark:text-[#cfc5b7]">
                  {detail.markdown}
                </pre>
              )}

              {rows.length > 0 ? (
                // Wide table: scrolls inside its own box so the page never
                // scrolls sideways.
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
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-t border-outline-variant dark:border-[#4c463c]"
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant dark:text-[#cfc5b7] opacity-70 py-6">
                  {detail.status === "failed" ? detail.error : t.erpStatusPending}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Export ────────────────────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-outline-variant dark:border-[#4c463c] flex flex-wrap items-center gap-3">
        {mappedIds.length > 0 ? (
          <>
            <a
              href={erpExportUrl(mappedIds, "xlsx")}
              className="px-5 py-2.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary dark:text-[#3d2e0e] text-sm font-label font-semibold hover:opacity-90 transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {t.erpExportXlsx}
            </a>
            <a
              href={erpExportUrl(mappedIds, "csv")}
              className="px-5 py-2.5 rounded-full border border-outline-variant dark:border-[#4c463c] text-sm font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all"
            >
              {t.erpExportCsv}
            </a>
            <span className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-60">
              {t.erpExportHint}
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
