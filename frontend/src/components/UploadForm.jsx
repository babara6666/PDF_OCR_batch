import { useState, useRef } from "react";

const UploadForm = ({ onFileSelect, selectedFile, onRemoveFile, onUpload, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileChange(files[0]);
    }
  };

  const handleFileChange = (file) => {
    if (file && file.type === "application/pdf") {
      onFileSelect(file);
    } else {
      alert("Please select a PDF file");
    }
  };

  const handleInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileChange(file);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="w-full max-w-[640px] flex flex-col gap-8">
      {/* Page Heading */}
      <div className="flex flex-col gap-3 text-center sm:text-left">
        <h1 className="text-4xl font-black leading-tight tracking-[-0.033em]">Upload your PDF</h1>
        <p className="text-slate-500 dark:text-[#92adc9] text-base font-normal leading-normal">
          We will convert your document into a clean Markdown file.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        className={`group relative flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-slate-300 dark:border-[#324d67] hover:border-primary/50 dark:hover:border-primary/50"
        } bg-slate-50 dark:bg-[#141f2a] transition-all cursor-pointer py-12 px-6`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-4 text-center pointer-events-none">
          <div className="size-16 rounded-full bg-slate-200 dark:bg-[#1e2b38] flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-3xl text-slate-500 dark:text-[#92adc9]">
              cloud_upload
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-lg font-bold leading-tight tracking-[-0.015em]">
              Drag & drop your file here
            </p>
            <p className="text-sm text-slate-500 dark:text-[#92adc9]">Supports PDF up to 50MB</p>
          </div>
          <div className="mt-4">
            <button className="pointer-events-none flex items-center justify-center rounded-lg h-10 px-6 bg-slate-900 dark:bg-[#233648] text-white text-sm font-bold shadow-sm">
              Browse Files
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          accept=".pdf"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          type="file"
          onChange={handleInputChange}
        />
      </div>

      {/* Selected File Preview */}
      {selectedFile && (
        <div className="flex flex-col gap-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Selected File</h3>
            <span className="text-xs font-medium text-slate-500 dark:text-[#92adc9]">
              Ready to convert
            </span>
          </div>
          <div className="relative flex items-center gap-4 rounded-lg bg-white dark:bg-[#192633] p-4 shadow-sm border border-slate-100 dark:border-transparent">
            {/* Icon Preview */}
            <div className="flex-shrink-0 size-12 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center text-red-500">
              <span className="material-symbols-outlined text-2xl">picture_as_pdf</span>
            </div>
            {/* File Info */}
            <div className="flex flex-col flex-1 min-w-0">
              <p className="text-sm font-bold truncate pr-4">{selectedFile.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-slate-500 dark:text-[#92adc9]">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            {/* Remove Action */}
            <button
              onClick={onRemoveFile}
              className="flex items-center justify-center size-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Primary Action */}
      {selectedFile && (
        <div className="pt-4">
          <button
            onClick={onUpload}
            disabled={isProcessing}
            className="w-full flex items-center justify-center rounded-xl h-14 px-8 bg-primary hover:bg-blue-600 disabled:bg-slate-400 text-white text-lg font-bold shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <span className="mr-2">{isProcessing ? "Processing..." : "Convert to Markdown"}</span>
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
          <p className="mt-4 text-center text-xs text-slate-400 dark:text-[#6a7e91]">
            Files are processed locally and not stored on any server.
          </p>
        </div>
      )}
    </div>
  );
};

export default UploadForm;
