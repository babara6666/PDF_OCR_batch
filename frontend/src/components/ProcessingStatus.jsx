import { useEffect, useState } from "react";

const ProcessingStatus = ({ progress, fileCount }) => {
  const [dots, setDots] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="w-full max-w-[800px] flex flex-col gap-6">
      {/* Page Heading */}
      <div className="text-center mb-4">
        <h1 className="text-3xl md:text-4xl font-black leading-tight tracking-[-0.033em] mb-3 text-slate-900 dark:text-white">
          Processing {fileCount} File{fileCount > 1 ? "s" : ""}
        </h1>
        <p className="text-slate-500 dark:text-[#92adc9] text-base md:text-lg font-normal max-w-xl mx-auto">
          Converting your documents into Markdown. This may take a while for
          large batches{dots}
        </p>
      </div>

      {/* Main Processing Card */}
      <div className="rounded-xl bg-white dark:bg-[#192633] border border-slate-200 dark:border-[#233648] shadow-sm overflow-hidden">
        {/* File Info Section */}
        <div className="p-6 md:p-8 border-b border-slate-200 dark:border-[#233648] flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[32px]">
                batch_prediction
              </span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center text-white border-2 border-white dark:border-[#192633]">
              <span className="material-symbols-outlined text-[14px] animate-spin">
                sync
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold truncate pr-4 text-slate-900 dark:text-white">
                Batch OCR Processing
              </h3>
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wide">
                Processing
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-[#92adc9]">
              {fileCount} file{fileCount > 1 ? "s" : ""} · Elapsed:{" "}
              {formatTime(elapsedSeconds)}
            </p>
          </div>
        </div>

        {/* Progress Section */}
        <div className="p-6 md:p-8 flex flex-col gap-6">
          {/* Progress Bar */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="text-sm font-medium text-slate-700 dark:text-white">
                Upload Progress
              </span>
              <span className="text-2xl font-bold text-primary">
                {progress}%
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-[#324d67] overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 w-full h-full animate-shimmer -skew-x-12 translate-x-[-100%]"></div>
              </div>
            </div>
          </div>

          {/* Info text */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20">
            <span className="material-symbols-outlined text-primary text-xl">
              info
            </span>
            <p className="text-sm text-slate-700 dark:text-blue-200">
              Files are uploaded first, then processed sequentially on the
              server. The server will return all results when processing is
              complete. Please keep this window open.
            </p>
          </div>

          {/* Animated loader */}
          <div className="flex items-center justify-center gap-2 py-4">
            <div className="flex gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "0ms" }}
              ></div>
              <div
                className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "150ms" }}
              ></div>
              <div
                className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "300ms" }}
              ></div>
            </div>
            <span className="text-sm font-medium text-slate-500 dark:text-[#92adc9] ml-2">
              Server is processing your files{dots}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcessingStatus;
