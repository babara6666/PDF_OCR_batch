/**
 * API service for backend communication
 */
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

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
 * @returns {Promise} Response with { results, total, succeeded }
 */
export const uploadBatch = async (files, onProgress, force = false) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });

  try {
    const response = await api.post(`/api/upload-batch?force=${force}`, formData, {
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

export default api;
