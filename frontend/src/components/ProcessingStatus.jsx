import { useEffect, useState } from "react";

const ProcessingStatus = ({ progress, currentStep, filename }) => {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const steps = [
    {
      id: 1,
      name: "File Upload",
      description: "Successfully uploaded to server",
      status: "completed",
    },
    {
      id: 2,
      name: "Document Analysis",
      description: "Layout and structure identified",
      status: currentStep >= 2 ? "completed" : "pending",
    },
    {
      id: 3,
      name: "OCR Scanning",
      description: "Extracting text from images and tables",
      status: currentStep >= 3 ? "active" : "pending",
    },
    {
      id: 4,
      name: "Markdown Generation",
      description: "Creating formatted output",
      status: currentStep >= 4 ? "active" : "pending",
    },
  ];

  return (
    <div className="w-full max-w-[800px] flex flex-col gap-6">
      {/* Page Heading */}
      <div className="text-center mb-4">
        <h1 className="text-3xl md:text-4xl font-black leading-tight tracking-[-0.033em] mb-3 text-slate-900 dark:text-white">
          Processing File
        </h1>
        <p className="text-slate-500 dark:text-[#92adc9] text-base md:text-lg font-normal max-w-xl mx-auto">
          Converting your PDF document into structured Markdown. Please keep this window open.
        </p>
      </div>

      {/* Main Processing Card */}
      <div className="rounded-xl bg-white dark:bg-[#192633] border border-slate-200 dark:border-[#233648] shadow-sm overflow-hidden">
        {/* File Info Section */}
        <div className="p-6 md:p-8 border-b border-slate-200 dark:border-[#233648] flex items-start md:items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
              <span className="material-symbols-outlined text-[32px]">picture_as_pdf</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center text-white border-2 border-white dark:border-[#192633]">
              <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold truncate pr-4 text-slate-900 dark:text-white">
                {filename}
              </h3>
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wide">
                Processing
              </span>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        <div className="p-6 md:p-8 flex flex-col gap-6">
          {/* Progress Bar */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="text-sm font-medium text-slate-700 dark:text-white">
                Overall Progress
              </span>
              <span className="text-2xl font-bold text-primary">{progress}%</span>
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

          {/* Steps Timeline */}
          <div className="grid grid-cols-[32px_1fr] gap-x-4 mt-2">
            {steps.map((step, index) => (
              <div key={step.id} className="contents">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      step.status === "completed"
                        ? "bg-green-500/20 text-green-500"
                        : step.status === "active"
                          ? "bg-primary text-white shadow-[0_0_0_4px_rgba(19,127,236,0.2)]"
                          : "bg-slate-100 dark:bg-[#324d67] text-slate-400 dark:text-[#92adc9]"
                    }`}
                  >
                    {step.status === "completed" ? (
                      <span className="material-symbols-outlined text-[18px]">check</span>
                    ) : step.status === "active" ? (
                      <span className="material-symbols-outlined text-[18px] animate-spin">
                        refresh
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">
                        {step.id === 4 ? "markdown" : "circle"}
                      </span>
                    )}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`w-[2px] h-full min-h-[24px] ${
                        step.status === "completed"
                          ? "bg-green-500/20"
                          : "bg-slate-200 dark:bg-[#324d67]"
                      }`}
                    ></div>
                  )}
                </div>
                <div className={index < steps.length - 1 ? "pb-6 pt-1" : "pt-1"}>
                  <p
                    className={`text-base font-semibold ${
                      step.status === "active"
                        ? "text-primary"
                        : step.status === "completed"
                          ? "text-slate-900 dark:text-white"
                          : "text-slate-400 dark:text-[#58738e]"
                    }`}
                  >
                    {step.name}
                    {step.status === "active" && dots}
                  </p>
                  <p
                    className={`text-sm ${
                      step.status === "active"
                        ? "text-slate-600 dark:text-[#d1e2f3]"
                        : step.status === "completed"
                          ? "text-slate-500 dark:text-[#92adc9]"
                          : "text-slate-400 dark:text-[#58738e]"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcessingStatus;
