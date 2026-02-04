/**
 * API service for backend communication
 */
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "multipart/form-data",
  },
});

/**
 * Upload PDF file and get markdown content
 * @param {File} file - PDF file to upload
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise} Response with markdown content
 */
export const uploadPDF = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await api.post("/api/upload", formData, {
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        if (onProgress) {
          onProgress(percentCompleted);
        }
      },
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      // Server responded with error
      throw new Error(error.response.data.detail || error.response.data.error || "Upload failed");
    } else if (error.request) {
      // No response from server
      throw new Error("No response from server. Is the backend running?");
    } else {
      // Other errors
      throw new Error(error.message || "Upload failed");
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
