/**
 * Is a mapped row's result inside its spec?
 *
 * The review table already holds everything needed — the spec string, the
 * separate limit columns, the result — so this runs in the browser on every
 * edit rather than round-tripping. It is a reviewer's aid, never a gate: the
 * export does not read it, and anything it cannot parse with confidence comes
 * back `none` rather than a guess.
 *
 * The formats below are the ones that actually occur across 四維's 43 supplier
 * reports (OUTPUT/*.xlsx), not an idealised grammar:
 *
 *   range      40~42%   ( 55 - 56 )   10000 ～ 18000   25℃ 2,500~6,000
 *   tolerance  80 ±9    75.0±1.0%     0.85±0.02        75+-5
 *   upper      ≤ 0.10   ≦ 4   <5   Max.40   250 MAX   0.43以下   2.0↓   ~0.10
 *   lower      ≥85.0    ≧ 98  >16  4 min.   min 77    78.0以上   15↑    99.7 ~
 *   columns    spec_min 29.50 / spec_max 30.50, with the spec cell empty
 *   text       Colorless → Colorless
 *
 * Numbers are written three ways — 2,500 (thousands), 44,0 (a European
 * decimal), 0. 071 (OCR split a decimal) — and all three are read.
 */

// A number as printed. Commas are resolved in toNumber(); the look-arounds
// keep dates and fractions out ("01/2022", "1/1000mm", "3,950/25℃").
const NUM = String.raw`[-+]?\d+(?:[.,]\d+)*`;
const NUM_ALONE = String.raw`(?<![\d/.,])(${NUM})(?!\d|\s*(?:℃|°\s*c))`;

const RANGE_RE = new RegExp(
  String.raw`(?<![\d/.,])(${NUM})\s*(?:~|～|〜|-|–|—|to|至)\s*(${NUM})(?![\d/])`,
  "i"
);
const TOL_RE = new RegExp(String.raw`(?<![\d/.,])(${NUM})\s*%?\s*(?:±|\+\s*/?\s*-)\s*(${NUM})`);
const UPPER_PREFIX_RE = new RegExp(
  String.raw`(≤|≦|<=|＜|<|max(?:imum)?\.?|不大於|不超過|~|～)\s*(${NUM})`,
  "gi"
);
const UPPER_SUFFIX_RE = new RegExp(
  String.raw`(?<![\d/.,])(${NUM})\s*[a-zμµ%/℃]*\s*(max(?:imum)?\.?|以下|↓|未滿)`,
  "gi"
);
const LOWER_PREFIX_RE = new RegExp(
  String.raw`(≥|≧|>=|＞|>|min(?:imum)?\.?|不小於|不低於)\s*(${NUM})`,
  "gi"
);
const LOWER_SUFFIX_RE = new RegExp(
  String.raw`(?<![\d/.,])(${NUM})\s*[a-zμµ%/℃]*\s*(min(?:imum)?\.?|以上|↑|~|～)`,
  "gi"
);

/** Full-width forms folded, OCR-split decimals rejoined. */
const clean = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/(\d)\s*\.\s+(\d)/g, "$1.$2")
    .trim();

/** "2,500" → 2500, "44,0" → 44, "1,234.5" → 1234.5. */
export const toNumber = (token) => {
  let t = String(token).replace(/\s+/g, "");
  if (t.includes(",")) {
    const [head, ...groups] = t.replace(/^[-+]/, "").split(",");
    const thousands = head.length <= 3 && groups.every((g) => g.length === 3);
    if (t.includes(".") || thousands) t = t.replace(/,/g, "");
    else if (groups.length === 1) t = t.replace(",", ".");
    else return null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const numbersIn = (s) =>
  [...clean(s).matchAll(new RegExp(NUM_ALONE, "g"))]
    .map((m) => toNumber(m[1]))
    .filter((v) => v !== null);

const firstNumber = (s) => numbersIn(s)[0] ?? null;

/**
 * The one value a family of bound patterns states: `undefined` when none
 * matched, `null` when they disagree ("0.1 max 1 max" is two items' limits
 * run together, and picking either is a guess).
 */
const oneBound = (text, patterns) => {
  const found = new Set();
  let strict = false;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const numFirst = /\d/.test(m[1]);
      const v = toNumber(numFirst ? m[1] : m[2]);
      if (v === null) continue;
      found.add(v);
      if (!numFirst && (m[1] === "<" || m[1] === ">")) strict = true;
    }
  }
  if (found.size === 0) return undefined;
  if (found.size > 1) return null;
  return { value: [...found][0], strict };
};

// Returned by readSpec when the spec states limits but not unambiguously.
const AMBIGUOUS = Symbol("ambiguous");

const readSpec = (spec) => {
  const text = clean(spec);
  if (!text) return null;

  const range = text.match(RANGE_RE);
  if (range) {
    const a = toNumber(range[1]);
    const b = toNumber(range[2]);
    if (a !== null && b !== null && a <= b) return { min: a, max: b };
  }

  const tol = text.match(TOL_RE);
  if (tol) {
    const c = toNumber(tol[1]);
    const d = toNumber(tol[2]);
    if (c !== null && d !== null) return { min: c - Math.abs(d), max: c + Math.abs(d) };
  }

  const lower = oneBound(text, [LOWER_SUFFIX_RE, LOWER_PREFIX_RE]);
  const upper = oneBound(text, [UPPER_SUFFIX_RE, UPPER_PREFIX_RE]);
  if (lower === null || upper === null) return AMBIGUOUS;
  if (!lower && !upper) return null;
  const out = {};
  if (lower) Object.assign(out, { min: lower.value, minStrict: lower.strict });
  if (upper) Object.assign(out, { max: upper.value, maxStrict: upper.strict });
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) return AMBIGUOUS;
  return out;
};

/**
 * The bounds a spec string states, or null when it states none this can read.
 * @returns {{min?: number, max?: number, minStrict?: boolean, maxStrict?: boolean} | null}
 */
export const parseSpec = (spec) => {
  const b = readSpec(spec);
  return b === AMBIGUOUS ? null : b;
};

/** The limits from the separate min/max columns, when the table had them. */
const parseColumns = (min, max) => {
  const lo = firstNumber(min);
  const hi = firstNumber(max);
  if (lo === null && hi === null) return null;
  // Min above max is a mapping mistake (63% / 53%), not a spec.
  if (lo !== null && hi !== null && lo > hi) return null;
  const out = {};
  if (lo !== null) out.min = lo;
  if (hi !== null) out.max = hi;
  return out;
};

const fmt = (v) => String(Math.round(v * 1e6) / 1e6);

export const boundsLabel = (b) => {
  if (!b) return "";
  if (b.min !== undefined && b.max !== undefined) return `${fmt(b.min)} ~ ${fmt(b.max)}`;
  if (b.max !== undefined) return `${b.maxStrict ? "<" : "≤"} ${fmt(b.max)}`;
  return `${b.minStrict ? ">" : "≥"} ${fmt(b.min)}`;
};

const squash = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[\s,，、.。;；:：]+/g, "");

const EPS = 1e-9;

/**
 * Judge one row.
 *
 * @returns {{status: "pass"|"fail"|"none", side?: "low"|"high", bounds?: object,
 *            label?: string, reason?: string}}
 *   `reason` for `none`: "no-result" | "no-spec" | "no-number" | "ambiguous".
 */
export const checkRow = (row) => {
  const result = clean(row?.result);
  if (!result) return { status: "none", reason: "no-result" };

  // The spec string wins over the limit columns: the columns are only meant to
  // be filled when the report had them (spec then empty), and when both are
  // present the columns are the likelier misreading — "75.0±1.0%" has been
  // mapped with 1.0% as its "upper limit".
  const fromSpec = readSpec(row?.spec);
  if (fromSpec === AMBIGUOUS) return { status: "none", reason: "ambiguous" };
  const bounds = fromSpec || parseColumns(row?.spec_min, row?.spec_max);

  if (!bounds) {
    const spec = squash(row?.spec);
    if (spec && !/\d/.test(spec) && spec === squash(result)) {
      return { status: "pass", reason: "text", label: clean(row.spec) };
    }
    return { status: "none", reason: "no-spec" };
  }

  const label = boundsLabel(bounds);
  // "< 20" is a result below the detection limit: it satisfies an upper bound
  // at or above 20 and says nothing about a lower one.
  const censored = [...result.matchAll(new RegExp(String.raw`([<＜≤≦])\s*(${NUM})`, "g"))];
  const values = censored.length
    ? censored.map((m) => ({ v: toNumber(m[2]), below: true }))
    : numbersIn(result).map((v) => ({ v, below: false }));
  if (!values.length || values.some(({ v }) => v === null)) {
    return { status: "none", reason: "no-number", bounds, label };
  }

  for (const { v, below } of values) {
    if (bounds.min !== undefined) {
      if (below) return { status: "none", reason: "no-number", bounds, label };
      if (bounds.minStrict ? v <= bounds.min + EPS : v < bounds.min - EPS) {
        return { status: "fail", side: "low", bounds, label };
      }
    }
    if (bounds.max !== undefined) {
      const over = bounds.maxStrict ? v >= bounds.max - EPS : v > bounds.max + EPS;
      if (over && !(below && v <= bounds.max + EPS)) {
        return { status: "fail", side: "high", bounds, label };
      }
    }
  }
  return { status: "pass", bounds, label };
};
