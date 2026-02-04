import { useState, useEffect } from "react";
import Header from "./components/Header";
import UploadForm from "./components/UploadForm";
import ProcessingStatus from "./components/ProcessingStatus";
import MarkdownPreview from "./components/MarkdownPreview";
import { uploadPDF } from "./services/api";

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Simulate processing steps
  useEffect(() => {
    if (isProcessing) {
      const stepInterval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev < 4) return prev + 1;
          return prev;
        });
      }, 2000);

      return () => clearInterval(stepInterval);
    }
  }, [isProcessing]);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setError(null);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProgress(0);
    setCurrentStep(1);
    setError(null);

    try {
      // Upload with progress tracking
      const response = await uploadPDF(selectedFile, (uploadProgress) => {
        // Upload is typically fast, so we'll use 0-20% for upload
        setProgress(Math.min(uploadProgress * 0.2, 20));
      });

      // Simulate processing progress (20-100%)
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 500);

      // Wait a bit to show the processing animation
      setTimeout(() => {
        clearInterval(progressInterval);
        setProgress(100);
        setResult(response);
        setIsProcessing(false);
      }, 3000);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err.message || "An error occurred during processing");
      setIsProcessing(false);
      setProgress(0);
      setCurrentStep(1);
    }
  };

  const handleNewUpload = () => {
    setSelectedFile(null);
    setResult(null);
    setProgress(0);
    setCurrentStep(1);
    setError(null);
  };

  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen flex flex-col text-slate-900 dark:text-white transition-colors duration-200">
      <Header />

      <main className="flex-1 flex flex-col items-center py-10 px-4 sm:px-40">
        {error && (
          <div className="w-full max-w-[640px] mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <span className="material-symbols-outlined">error</span>
              <span className="font-semibold">Error:</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {!isProcessing && !result && (
          <UploadForm
            onFileSelect={handleFileSelect}
            selectedFile={selectedFile}
            onRemoveFile={handleRemoveFile}
            onUpload={handleUpload}
            isProcessing={isProcessing}
          />
        )}

        {isProcessing && (
          <ProcessingStatus
            progress={progress}
            currentStep={currentStep}
            filename={selectedFile?.name || "document.pdf"}
          />
        )}

        {!isProcessing && result && (
          <MarkdownPreview
            filename={result.filename}
            markdown={result.markdown_content}
            fileSize={result.file_size}
            onNewUpload={handleNewUpload}
          />
        )}
      </main>
    </div>
  );
}

export default App;
