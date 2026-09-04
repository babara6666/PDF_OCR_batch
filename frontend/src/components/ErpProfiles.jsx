import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  addErpSamples,
  deleteErpProfile,
  draftErpProfile,
  getErpProfile,
  importErpAliasTable,
  listErpProfiles,
  listErpSamples,
  saveErpProfile,
  uploadBatch,
  uploadErpExpected,
} from "../services/api";

/**
 * Managing one customer's profile: which columns their ERP template expects,
 * and what their suppliers call those things.
 *
 * Two ways in, both starting from files the customer already owns:
 *
 *   • their alias table (key.xlsx) — read straight across, no model. The
 *     workbook already *is* the mapping.
 *   • reports they have already done — a COA plus the import workbook they
 *     filled in for it. The PDF alone carries the supplier's column names but
 *     not the judgement about what they map to; the answer beside it does.
 *
 * Neither one saves anything on its own. Both produce a draft that lands in
 * the editor below, and a person presses Save. A learned alias nobody looked
 * at is the same unverified-rule problem this mode exists to get away from.
 */

const PILL =
  "px-4 py-1.5 rounded-full border border-outline-variant dark:border-[#4c463c] " +
  "text-xs font-label hover:bg-surface-container-high dark:hover:bg-[#2a2a2a] transition-all";
const PILL_FILLED =
  "px-4 py-1.5 rounded-full bg-primary dark:bg-[#dcc497] text-on-primary " +
  "dark:text-[#3d2e0e] text-xs font-label font-semibold hover:opacity-90 transition-all " +
  "disabled:opacity-40 disabled:cursor-not-allowed";
const INPUT =
  "px-3 py-1.5 rounded-lg border border-outline-variant dark:border-[#4c463c] " +
  "bg-transparent text-sm text-on-background dark:text-[#e5e2e1] " +
  "focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-[#dcc497]";

// Profile ids become filenames and travel in URLs; the backend enforces the
// same shape, this just stops the round trip.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const blankColumn = () => ({
  key: "",
  name: "",
  required: false,
  description: "",
  aliases: [],
});

const ErpProfiles = ({ onClose, onProfileSaved }) => {
  const { t } = useT();

  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState("default");
  const [draft, setDraft] = useState(null); // {name, columns, rules}
  const [samples, setSamples] = useState([]);
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);

  const aliasFileRef = useRef(null);
  const sampleFileRef = useRef(null);
  const answerFor = useRef(null); // job id the next answer workbook belongs to
  const answerFileRef = useRef(null);

  const isBuiltin = selected === "default";

  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles((await listErpProfiles()).profiles || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  // Load whichever profile is selected, plus its learning material.
  useEffect(() => {
    let cancelled = false;
    setNotes("");
    getErpProfile(selected)
      .then((d) => {
        if (cancelled) return;
        setDraft({
          name: d.name || "",
          columns: (d.columns || []).map((c) => ({ ...c, aliases: c.aliases || [] })),
          rules: d.rules || [],
        });
      })
      .catch((e) => !cancelled && setError(e.message));
    listErpSamples(selected)
      .then((d) => !cancelled && setSamples(d.samples || []))
      .catch(() => !cancelled && setSamples([]));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const createProfile = async () => {
    const id = newId.trim();
    if (!ID_RE.test(id)) {
      setError(t.erpProfileNewName);
      return;
    }
    // Starts from the built-in columns rather than nothing: most customers
    // want the same seven things under their own names, and starting from a
    // blank sheet is how people give up.
    setSelected("default");
    const base = await getErpProfile("default");
    setDraft({
      name: id,
      columns: (base.columns || []).map((c) => ({ ...c, aliases: [] })),
      rules: base.rules || [],
    });
    setNewId("");
    setSelected(id);
    setProfiles((p) =>
      p.some((x) => x.id === id) ? p : [...p, { id, name: id, column_count: 0, alias_count: 0 }]
    );
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await saveErpProfile(selected, { ...draft, version: 1 });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      setError(null);
      refreshProfiles();
      onProfileSaved?.(selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      await deleteErpProfile(selected);
      setSelected("default");
      refreshProfiles();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Learning ───────────────────────────────────────────────────────────────
  const onAliasTable = async (file) => {
    if (!file) return;
    setBusy("alias");
    try {
      const d = await importErpAliasTable(selected, file);
      // Replaces the column set outright: this workbook *is* their template,
      // so anything already in the editor was a guess at the same thing.
      setDraft((cur) => ({ ...cur, columns: d.draft.columns }));
      setNotes("");
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const onSampleFiles = async (files) => {
    if (!files.length) return;
    setBusy("samples");
    try {
      // Same OCR front half as a real report — a sample has to be read the
      // way the documents it is teaching about will be read.
      const res = await uploadBatch(files, null, false, false);
      await addErpSamples(
        selected,
        res.results.map((r) => ({
          filename: r.filename,
          markdown: r.markdown_content || "",
          engine: r.engine || "",
          alt_markdown: r.fastdoc_markdown || "",
          alt_engine: r.fastdoc_markdown ? "fastdoc" : "",
          error: r.success ? "" : r.error || "",
        }))
      );
      setSamples((await listErpSamples(selected)).samples || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const onAnswerFile = async (file) => {
    if (!file || !answerFor.current) return;
    setBusy("answer");
    try {
      await uploadErpExpected(answerFor.current, file);
      setSamples((await listErpSamples(selected)).samples || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      answerFor.current = null;
      setBusy("");
    }
  };

  const runDraft = async () => {
    setBusy("draft");
    try {
      const d = await draftErpProfile(selected);
      setDraft((cur) => ({ ...cur, columns: d.draft.columns }));
      setNotes(
        [t.erpLearnDraftReady, t.erpLearnDraftBy(d.drafted_by), d.notes].filter(Boolean).join(" · ")
      );
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  // ── Column editing ─────────────────────────────────────────────────────────
  const editColumn = (i, patch) =>
    setDraft((cur) => ({
      ...cur,
      columns: cur.columns.map((c, n) => (n === i ? { ...c, ...patch } : c)),
    }));

  const addColumn = () => setDraft((cur) => ({ ...cur, columns: [...cur.columns, blankColumn()] }));

  const removeColumn = (i) =>
    setDraft((cur) => ({ ...cur, columns: cur.columns.filter((_, n) => n !== i) }));

  return (
    <section className="flex-1 px-6 md:px-10 py-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div className="space-y-1">
          <span className="text-primary dark:text-[#dcc497] font-label font-bold tracking-[0.2em] text-xs uppercase">
            {t.modeErp}
          </span>
          <h2 className="font-headline text-4xl text-on-background dark:text-[#e5e2e1] font-black tracking-tighter">
            {t.erpProfileManage}
          </h2>
        </div>
        <button onClick={onClose} className={PILL}>
          {t.erpProfileBack}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container dark:bg-[#93000a]/30 border border-error/30 rounded-2xl text-error dark:text-[#ffb4ab] text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ── Profile list ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`w-full text-left rounded-2xl px-4 py-3 border transition-all ${
                selected === p.id
                  ? "border-primary dark:border-[#dcc497] bg-surface-container-low dark:bg-[#1c1b1b]"
                  : "border-outline-variant dark:border-[#4c463c] hover:bg-surface-container-high dark:hover:bg-[#2a2a2a]"
              }`}
            >
              <p className="text-sm font-semibold text-on-background dark:text-[#e5e2e1] truncate">
                {p.builtin ? t.erpProfileDefault : p.name || p.id}
              </p>
              <p className="text-[11px] text-on-surface-variant dark:text-[#cfc5b7] opacity-70 mt-1">
                {t.erpProfileCols(p.column_count)} · {t.erpProfileAliases(p.alias_count)}
              </p>
            </button>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder={t.erpProfileNew}
              className={`${INPUT} flex-1 min-w-0`}
            />
            <button onClick={createProfile} className={PILL_FILLED}>
              +
            </button>
          </div>
        </div>

        {/* ── Editor ────────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          {isBuiltin && (
            <p className="text-xs text-tertiary dark:text-[#dcc497]">{t.erpProfileBuiltin}</p>
          )}

          {/* Learning material */}
          {!isBuiltin && (
            <div className="rounded-3xl border border-outline-variant dark:border-[#4c463c] p-6 space-y-5">
              <h3 className="font-headline text-lg text-on-background dark:text-[#e5e2e1] font-semibold">
                {t.erpLearnHeading}
              </h3>

              {/* Path 1: their alias table. No model — a transcription. */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => aliasFileRef.current?.click()}
                    disabled={busy === "alias"}
                    className={PILL_FILLED}
                  >
                    {busy === "alias" ? "…" : t.erpLearnAliasTable}
                  </button>
                  <input
                    ref={aliasFileRef}
                    type="file"
                    accept=".xlsx,.xlsm"
                    className="hidden"
                    onChange={(e) => onAliasTable(e.target.files?.[0])}
                  />
                </div>
                <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                  {t.erpLearnAliasHelp}
                </p>
              </div>

              {/* Path 2: reports they have already done by hand. */}
              <div className="space-y-2 pt-2 border-t border-outline-variant dark:border-[#4c463c]">
                <div className="flex flex-wrap items-center gap-3 pt-3">
                  <button
                    onClick={() => sampleFileRef.current?.click()}
                    disabled={busy === "samples"}
                    className={PILL}
                  >
                    {busy === "samples" ? "…" : t.erpLearnAddSample}
                  </button>
                  <input
                    ref={sampleFileRef}
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => onSampleFiles([...(e.target.files || [])])}
                  />
                  <button
                    onClick={runDraft}
                    disabled={busy === "draft" || samples.length === 0}
                    className={PILL_FILLED}
                  >
                    {busy === "draft" ? t.erpLearnDrafting : t.erpLearnDraft}
                  </button>
                </div>
                <p className="text-xs text-on-surface-variant dark:text-[#cfc5b7] opacity-70">
                  {t.erpLearnSamplesHelp}
                </p>

                {samples.length > 0 && (
                  <ul className="space-y-1.5 pt-2">
                    {samples.map((s) => (
                      <li
                        key={s.job_id}
                        className="flex flex-wrap items-center gap-2 text-xs text-on-background dark:text-[#e5e2e1]"
                      >
                        <span className="truncate max-w-[18rem]">{s.filename}</span>
                        {s.expected_row_count > 0 ? (
                          <span className="text-primary dark:text-[#dcc497]">
                            {t.erpLearnRows(s.expected_row_count)}
                          </span>
                        ) : (
                          <span className="text-tertiary dark:text-[#dcc497] opacity-70">
                            {t.erpLearnNoAnswer}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            answerFor.current = s.job_id;
                            answerFileRef.current?.click();
                          }}
                          className="underline text-primary dark:text-[#dcc497]"
                        >
                          {t.erpLearnAnswer}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={answerFileRef}
                  type="file"
                  accept=".xlsx,.xlsm"
                  className="hidden"
                  onChange={(e) => onAnswerFile(e.target.files?.[0])}
                />
              </div>

              {notes && (
                <p className="text-xs text-tertiary dark:text-[#dcc497] bg-tertiary/10 dark:bg-[#dcc497]/10 rounded-xl px-3 py-2">
                  {notes}
                </p>
              )}
            </div>
          )}

          {/* Column editor — the thing that actually gets saved. */}
          {draft && (
            <div className="space-y-3">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                disabled={isBuiltin}
                placeholder={t.erpProfile}
                className={`${INPUT} w-full max-w-md disabled:opacity-60`}
              />

              {draft.columns.map((c, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-outline-variant dark:border-[#4c463c] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={c.name}
                      onChange={(e) => editColumn(i, { name: e.target.value })}
                      disabled={isBuiltin}
                      placeholder="欄位名稱"
                      className={`${INPUT} font-semibold w-40 disabled:opacity-60`}
                    />
                    <input
                      value={c.key}
                      onChange={(e) => editColumn(i, { key: e.target.value })}
                      disabled={isBuiltin}
                      placeholder="key"
                      className={`${INPUT} font-mono text-xs w-36 disabled:opacity-60`}
                    />
                    <label className="flex items-center gap-1.5 text-xs font-label text-on-surface-variant dark:text-[#cfc5b7]">
                      <input
                        type="checkbox"
                        checked={Boolean(c.required)}
                        disabled={isBuiltin}
                        onChange={(e) => editColumn(i, { required: e.target.checked })}
                        className="accent-primary dark:accent-[#dcc497]"
                      />
                      {t.erpProfileRequired}
                    </label>
                    <span className="text-[11px] text-on-surface-variant dark:text-[#cfc5b7] opacity-60 ml-auto">
                      {t.erpProfileAliases(c.aliases.length)}
                    </span>
                    {!isBuiltin && (
                      <button
                        onClick={() => removeColumn(i)}
                        aria-label={t.erpDeleteRow}
                        className="w-7 h-7 rounded-full grid place-items-center text-error dark:text-[#ffb4ab] hover:bg-error-container dark:hover:bg-[#93000a]/30"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    )}
                  </div>

                  <textarea
                    value={c.aliases.join("\n")}
                    onChange={(e) =>
                      editColumn(i, {
                        aliases: e.target.value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    disabled={isBuiltin}
                    rows={Math.min(8, Math.max(2, c.aliases.length))}
                    aria-label={t.erpProfileAliasesFor(c.name || c.key)}
                    placeholder={t.erpProfileAliasHint}
                    className={`${INPUT} w-full font-mono text-xs disabled:opacity-60`}
                  />
                </div>
              ))}

              {!isBuiltin && (
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button onClick={addColumn} className={PILL}>
                    {t.erpProfileAddCol}
                  </button>
                  <button onClick={save} disabled={busy === "save"} className={PILL_FILLED}>
                    {t.erpProfileSave}
                  </button>
                  {saved && (
                    <span className="text-xs font-label text-primary dark:text-[#dcc497]">
                      {t.erpProfileSaved}
                    </span>
                  )}
                  <button
                    onClick={remove}
                    className={`${PILL} text-error dark:text-[#ffb4ab] ml-auto`}
                  >
                    {t.erpProfileDelete}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default ErpProfiles;
