import React, { useState, useRef } from "react";
import { analyzeResume } from "../api/client";

/**
 * Upload component configured for the split-screen dashboard layout.
 */
export default function Upload({ onResult, onLoadingChange }) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const inputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndSetFile = (selectedFile) => {
    if (!selectedFile) return;

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const fileExtension = selectedFile.name.split(".").pop().toLowerCase();
    const isValidExtension = fileExtension === "pdf" || fileExtension === "docx";
    const isValidType = validTypes.includes(selectedFile.type) || isValidExtension;

    if (!isValidType) {
      setError("Unsupported file format. Please upload a PDF or DOCX file.");
      setFile(null);
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("File is too large. The maximum allowed size is 5MB.");
      setFile(null);
      return;
    }

    setError(null);
    setFile(selectedFile);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleButtonClick = () => {
    inputRef.current.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    if (onLoadingChange) onLoadingChange(true);
    setError(null);

    try {
      const response = await analyzeResume(file);
      if (onResult) {
        onResult(response, file.name);
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred during resume analysis.");
    } finally {
      setLoading(false);
      if (onLoadingChange) onLoadingChange(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-3">
        
        {/* Drag & Drop Zone - background #6f1d1b, dashed border #99582a, text #ffe6a7, browse link #bb9457 */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed bg-[#6f1d1b] rounded-xl py-4 px-4 transition-colors duration-200 flex flex-col items-center justify-center cursor-pointer ${
            dragActive ? "border-[#bb9457]" : "border-[#99582a] hover:border-[#bb9457]"
          }`}
          onClick={handleButtonClick}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx"
            onChange={handleChange}
            disabled={loading}
          />

          {/* Cloud Icon */}
          <div className="w-8 h-8 rounded-full bg-[#432818] flex items-center justify-center mb-1.5 text-[#ffe6a7] border border-[#99582a]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
              />
            </svg>
          </div>

          <p className="text-[11px] font-semibold text-[#ffe6a7] mb-0.5 text-center">
            Drag & drop here, or{" "}
            <span className="text-[#bb9457] hover:underline font-bold">
              browse
            </span>
          </p>
          <p className="text-[9px] text-[#99582a]">PDF or DOCX (max. 5MB)</p>
        </div>

        {/* Submit Button - full width, solid #bb9457, #432818 text, 50px border radius, font-weight 700 */}
        <button
          type="submit"
          disabled={!file || loading}
          className={`w-full py-2 px-3 rounded-[50px] font-bold transition-all duration-200 flex items-center justify-center space-x-2 ${
            !file
              ? "bg-[#99582a] cursor-not-allowed text-[#432818]/60"
              : loading
              ? "bg-[#bb9457]/70 cursor-wait text-[#432818]"
              : "bg-[#bb9457] hover:bg-[#ffe6a7] text-[#432818] shadow-md shadow-[#432818]/50"
          }`}
        >
          {loading ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-[#432818]"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="text-xs">Analyzing...</span>
            </>
          ) : (
            <span className="text-xs">Analyze Resume</span>
          )}
        </button>

        {/* Selected File Details - Rendered BELOW the button after upload */}
        {file && (
          <div className="bg-[#6f1d1b] border border-[#99582a] rounded-lg p-2 flex items-center justify-between animate-fadeIn">
            <div className="flex items-center space-x-2 overflow-hidden">
              {/* Green checkmark icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-[#bb9457] flex-shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="truncate text-[11px]">
                <p className="font-semibold text-[#ffe6a7] truncate">
                  {file.name}
                </p>
                <p className="text-[9px] text-[#bb9457]">
                  {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="text-[#bb9457] hover:text-[#ffe6a7] p-1 flex-shrink-0"
              onClick={() => setFile(null)}
              disabled={loading}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-[#6f1d1b] border border-[#99582a] rounded-lg p-2.5 flex items-start space-x-2 text-[#ffe6a7] text-[11px] animate-fadeIn">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4 flex-shrink-0 text-[#bb9457]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <div className="flex-1 font-semibold leading-relaxed">{error}</div>
          </div>
        )}
      </form>
    </div>
  );
}
