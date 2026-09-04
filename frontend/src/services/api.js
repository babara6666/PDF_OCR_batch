/**
 * API service for backend communication
 */
import axios from "axios";

// Relative by default: requests go to the same origin the page was served
// from, and whatever sits in front (vite proxy in dev, nginx in prod)
// forwards /api/* to the backend. A hardcoded host would send every LAN
// visitor's browser to its own localhost, where nothing is listening.
// Only set VITE_API_BASE_URL when the API genuinely lives on another origin.
// "/" is what the all-in-one image bakes in ("same origin"). Treat it as
// empty so template URLs become `/api/...` not `//api/...` (a protocol-relative
// URL that the browser sends to host `api`).
const _rawBase = import.meta.env.VITE_API_BASE_URL || "";
const API_BASE_URL = (() => {
  const v = String(_rawBase).trim();
  // `same-origin` is the docker build-arg sentinel (a lone `/` is rewritten
  // by Git Bash/MSYS to `C:/Program Files/Git/`, which axios then uses as
  // baseURL and the browser throws "Unsupported protocol C:").
  if (!v || v === "/" || v === "same-origin") return "";
  if (/^[A-Za-z]:[\\/]/.test(v)) return "";
  return v.replace(/\/$/, "");
})();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "multipart/form-data",
  },
});

/**
 * Upload single PDF/image file and get markdown content
 * @param {File} file - PDF or image file to upload
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise} Response with markdown content
 */
export const uploadPDF = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await api.post("/api/upload", formData, {
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total,
        );
        if (onProgress) {
          onProgress(percentCompleted);
        }
      },
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        error.response.data.detail ||
          error.response.data.error ||
          "Upload failed",
      );
    } else if (error.request) {
      throw new Error("No response from server. Is the backend running?");
    } else {
      throw new Error(error.message || "Upload failed");
    }
  }
};

/**
 * Run quality checks on multiple files without performing OCR.
 * @param {File[]} files - Files to check
 * @param {Object} thresholds - { minSharpness, minBrightness, maxBrightness, minContrast }
 * @param {Function} onProgress - Upload progress callback (0-100)
 * @returns {Promise} Response with { results, total, passed }
 */
export const checkQualityBatch = async (files, thresholds = {}, onProgress) => {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const {
    minSharpness   = 2.0,
    minBrightness  = 25.0,
    maxBrightness  = 245.0,
    minContrast    = 15.0,
  } = thresholds;

  const params = new URLSearchParams({
    min_sharpness:  minSharpness,
    min_brightness: minBrightness,
    max_brightness: maxBrightness,
    min_contrast:   minContrast,
  });

  try {
    const response = await api.post(`/api/check-quality-batch?${params}`, formData, {
      timeout: 60_000 + files.length * 30_000,
      onUploadProgress: (progressEvent) => {
        const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        if (onProgress) onProgress(pct);
      },
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data.detail || error.response.data.error || "Quality check failed");
    } else if (error.request) {
      throw new Error("No response from server. Is the backend running?");
    } else {
      throw new Error(error.message || "Quality check failed");
    }
  }
};

/**
 * Upload multiple PDF/image files for batch OCR
 * @param {File[]} files - Array of files to upload
 * @param {Function} onProgress - Upload progress callback (0-100)
 * @param {boolean} force - Skip quality-check blocking
 * @param {boolean} dual - Run both engines and return both outputs
 * @returns {Promise} Response with { results, total, succeeded }
 */
export const uploadBatch = async (files, onProgress, force = false, dual = false) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });

  // `dual` is always sent explicitly so the toggle can turn dual output off
  // even when the server defaults it on via FASTDOC_DUAL.
  const params = new URLSearchParams({ force: String(force), dual: String(dual) });

  try {
    const response = await api.post(`/api/upload-batch?${params}`, formData, {
      timeout: 300_000 + files.length * 600_000, // 5min base + 10min per file
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total,
        );
        if (onProgress) {
          onProgress(percentCompleted);
        }
      },
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        error.response.data.detail ||
          error.response.data.error ||
          "Batch upload failed",
      );
    } else if (error.request) {
      throw new Error("No response from server. Is the backend running?");
    } else {
      throw new Error(error.message || "Batch upload failed");
    }
  }
};

/**
 * Extract 'Notes:' section from multiple engineering drawing PDFs.
 * @param {File[]} files         - PDF/image files to process
 * @param {boolean} includeImage - Whether to request base64 crop images
 * @param {Function} onProgress  - Upload progress callback (0-100)
 * @returns {Promise} Response with { results, total, succeeded }
 */
export const extractNotesBatch = async (
  files,
  includeImage = true,
  onProgress,
) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });

  try {
    const response = await api.post(
      `/api/extract-notes-batch?include_image=${includeImage ? "true" : "false"}`,
      formData,
      {
        timeout: 300_000 + files.length * 600_000,
        onUploadProgress: (progressEvent) => {
          const pct = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          if (onProgress) onProgress(pct);
        },
      },
    );
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        error.response.data.detail ||
          error.response.data.error ||
          "Notes extraction failed",
      );
    } else if (error.request) {
      throw new Error("No response from server. Is the backend running?");
    } else {
      throw new Error(error.message || "Notes extraction failed");
    }
  }
};

/**
 * Check API health
 * @returns {Promise} Health status
 */
export const checkHealth = async () => {
  try {
    const response = await api.get("/api/health");
    return response.data;
  } catch (error) {
    throw new Error("Backend is not responding");
  }
};


// ─── ERP import mode ──────────────────────────────────────────────────────────
// These talk JSON, not multipart — the shared `api` instance sets a
// multipart Content-Type, so each call overrides it.
const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

const erpError = (error, fallback) => {
  if (error.response) {
    return new Error(
      error.response.data?.detail || error.response.data?.error || fallback,
    );
  }
  if (error.request) {
    return new Error("No response from server. Is the backend running?");
  }
  return new Error(error.message || fallback);
};

/**
 * Stage OCR'd documents for 知識通 to map.
 * @param {Array<{filename: string, markdown: string, engine?: string, error?: string}>} documents
 * @param {string} batchId - groups the files uploaded together
 * @returns {Promise<{jobs: Array}>}
 */
export const stageErpJobs = async (documents, batchId, profileId = "default") => {
  try {
    const response = await api.post(
      "/api/erp/jobs",
      { documents, batch_id: batchId, profile_id: profileId },
      JSON_HEADERS,
    );
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to stage documents for ERP import");
  }
};

/**
 * List staged jobs, newest first.
 * @param {{status?: string, batchId?: string}} opts
 */
export const listErpJobs = async ({ status, batchId } = {}) => {
  try {
    const params = {};
    if (status) params.status = status;
    if (batchId) params.batch_id = batchId;
    const response = await api.get("/api/erp/jobs", { params });
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to list ERP jobs");
  }
};

/** Full job: metadata, mapped rows, and (optionally) the source markdown. */
export const getErpJob = async (jobId, { includeMarkdown = false } = {}) => {
  try {
    const response = await api.get(`/api/erp/jobs/${jobId}`, {
      params: { include_markdown: includeMarkdown },
    });
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to load ERP job");
  }
};

/**
 * Overwrite a job's rows — used when a human corrects what 知識通 returned.
 * @returns {Promise} the stored rows plus any warnings the backend raised
 */
export const putErpRows = async (jobId, rows, { mappedBy = "人工覆核", notes = "" } = {}) => {
  try {
    const response = await api.put(
      `/api/erp/jobs/${jobId}/rows`,
      { rows, mapped_by: mappedBy, notes },
      JSON_HEADERS,
    );
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to save rows");
  }
};

/**
 * Attach the original PDF to a staged job so the reviewer can see the page it
 * came from. Sent after staging rather than with it: the markdown is a few KB
 * and everything downstream waits on it, while the PDF is megabytes that
 * nothing waits on. Failure is not fatal — the review pane falls back to the
 * markdown — so callers treat a rejection as a missing pane, not an error.
 */
export const uploadErpSource = async (jobId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const response = await api.post(`/api/erp/jobs/${jobId}/source`, formData);
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to attach the source PDF");
  }
};

/**
 * URL of one rendered page of a job's source PDF.
 *
 * An image, not the PDF: the app's CSP sets `object-src 'none'` and
 * `frame-ancestors 'none'`, so an embedded PDF viewer is blocked even
 * same-origin. `img-src 'self'` is open, so a rendered page just works.
 */
export const erpPageUrl = (jobId, pageNo, width = 1400) =>
  `${API_BASE_URL}/api/erp/jobs/${jobId}/page/${pageNo}.png?w=${width}`;

/** Record (or take back) a human's sign-off on a job's rows. */
export const setErpReviewed = async (jobId, reviewed) => {
  try {
    const response = reviewed
      ? await api.post(`/api/erp/jobs/${jobId}/review`)
      : await api.delete(`/api/erp/jobs/${jobId}/review`);
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to update the review state");
  }
};

export const deleteErpJob = async (jobId) => {
  try {
    const response = await api.delete(`/api/erp/jobs/${jobId}`);
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to discard job");
  }
};

/**
 * Which mapping engines this deployment can drive, and their models.
 * Never fails on a down server — an unreachable Ollama or gateway comes back
 * with the curated model list and an `error`, so the picker is never empty.
 */
export const getErpLlm = async () => {
  try {
    const response = await api.get("/api/erp/llm");
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to load the mapping engines");
  }
};

/** Map one report and wait for it — the retry button on a failed job. */
export const mapErpJob = async (jobId, { provider = "", model = "" } = {}) => {
  try {
    const response = await api.post(
      `/api/erp/jobs/${jobId}/map`,
      { provider, model },
      JSON_HEADERS,
    );
    return response.data;
  } catch (error) {
    throw erpError(error, "Mapping failed");
  }
};

/**
 * Map the whole pending queue in the background. Returns as soon as the work
 * is queued; the 5s poll on the results page reports progress.
 */
export const mapErpBatch = async ({ batchId = "", provider = "", model = "" } = {}) => {
  try {
    const response = await api.post(
      "/api/erp/map",
      { batch_id: batchId, provider, model },
      JSON_HEADERS,
    );
    return response.data;
  } catch (error) {
    throw erpError(error, "Mapping failed");
  }
};

/** The ERP column definition + supplier alias list, for one customer profile. */
export const getErpSchema = async (profile = "default") => {
  try {
    const response = await api.get("/api/erp/schema", { params: { profile } });
    return response.data;
  } catch (error) {
    throw erpError(error, "Failed to load ERP schema");
  }
};

// ─── Customer profiles ────────────────────────────────────────────────────────
// One profile = one customer's ERP columns plus what their suppliers call those
// things. `default` is the built-in one and is read-only.

export const listErpProfiles = async () => {
  try {
    return (await api.get("/api/erp/profiles")).data;
  } catch (error) {
    throw erpError(error, "Failed to list profiles");
  }
};

export const getErpProfile = async (profile) => {
  try {
    return (await api.get(`/api/erp/profiles/${profile}`)).data;
  } catch (error) {
    throw erpError(error, "Failed to load the profile");
  }
};

export const saveErpProfile = async (profile, body) => {
  try {
    return (await api.put(`/api/erp/profiles/${profile}`, body, JSON_HEADERS)).data;
  } catch (error) {
    throw erpError(error, "Failed to save the profile");
  }
};

export const deleteErpProfile = async (profile) => {
  try {
    return (await api.delete(`/api/erp/profiles/${profile}`)).data;
  } catch (error) {
    throw erpError(error, "Failed to delete the profile");
  }
};

/**
 * Read the customer's own alias table (their key.xlsx) into a draft.
 * No model involved — the sheet already *is* the mapping.
 */
export const importErpAliasTable = async (profile, file) => {
  const formData = new FormData();
  formData.append("file", file);
  try {
    return (await api.post(`/api/erp/profiles/${profile}/alias-table`, formData)).data;
  } catch (error) {
    throw erpError(error, "Failed to read the alias table");
  }
};

export const listErpSamples = async (profile) => {
  try {
    return (await api.get(`/api/erp/profiles/${profile}/samples`)).data;
  } catch (error) {
    throw erpError(error, "Failed to list samples");
  }
};

/** Stage OCR'd reports as learning material. Same shape as stageErpJobs. */
export const addErpSamples = async (profile, documents) => {
  try {
    return (await api.post(`/api/erp/profiles/${profile}/samples`, { documents }, JSON_HEADERS))
      .data;
  } catch (error) {
    throw erpError(error, "Failed to add samples");
  }
};

/** Attach the workbook the customer already filled in for one sample. */
export const uploadErpExpected = async (jobId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  try {
    return (await api.post(`/api/erp/jobs/${jobId}/expected`, formData)).data;
  } catch (error) {
    throw erpError(error, "Failed to read the answer workbook");
  }
};

/** Generalise the staged samples into a column draft. Saves nothing. */
export const draftErpProfile = async (profile, { provider = "", model = "" } = {}) => {
  try {
    return (
      await api.post(`/api/erp/profiles/${profile}/draft`, { provider, model }, JSON_HEADERS)
    ).data;
  } catch (error) {
    throw erpError(error, "Failed to draft the profile");
  }
};

/** Keep a report a human just reviewed as a learning sample for its profile. */
export const teachFromErpJob = async (jobId) => {
  try {
    return (await api.post(`/api/erp/jobs/${jobId}/teach`)).data;
  } catch (error) {
    throw erpError(error, "Failed to keep this report as a sample");
  }
};

/**
 * URL of the ERP import file. Returned as a URL rather than fetched, so the
 * browser downloads it directly and the Content-Disposition filename (which
 * carries the Chinese name) survives.
 */
export const erpExportUrl = (jobIds, fmt = "xlsx", { onlyReviewed = true } = {}) => {
  const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
  // The batch endpoint holds back anything nobody has signed off on; the
  // single-file one never did, because 知識通 hands that link out as a preview
  // of what it read. Always go through the batch endpoint here so one report
  // and five behave the same way in the UI.
  return (
    `${API_BASE_URL}/api/erp/export.${fmt}` +
    `?job_ids=${ids.join(",")}&only_reviewed=${onlyReviewed}`
  );
};

export default api;
