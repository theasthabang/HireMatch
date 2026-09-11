import React, { useState, useRef, useEffect } from "react";
import { analyzeResume, fetchIndustries } from "../api/client";

/**
 * Upload — graded-paper system. Same functionality as before (drag/drop,
 * validation, optional JD field), rebuilt visually: thin hairline dropzone
 * instead of a dashed gold border, quiet ink button instead of a gold pill.
 *
 * Industry/background dropdown added above the dropzone (per explicit
 * placement request — "before the resume upload step"). Fetched once from
 * GET /industries rather than hardcoded, so the taxonomy stays the single
 * source of truth on both ends. "general" (the default, always-first
 * option) sends nothing extra to the backend — see client.js's
 * analyzeResume/reanalyzeResume, which both skip the industry field
 * entirely when it's "general", identical to the pre-feature request shape.
 */
export default function Upload({ onResult, onLoadingChange, jobDescription = "", onJobDescriptionChange, industry = "general", onIndustryChange }) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showJobDescription, setShowJobDescription] = useState(false);
  const [industries, setIndustries] = useState([{ id: "general", label: "General / Tech" }]);
  const [industriesLoadFailed, setIndustriesLoadFailed] = useState(false);

  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchIndustries()
      .then((list) => {
        if (!cancelled && list.length > 0) setIndustries(list);
      })
      .catch(() => {
        // Non-fatal — the dropdown just falls back to "General / Tech" only,
        // which is functionally identical to not selecting an industry at
        // all, so this never blocks the person from analyzing their resume.
        if (!cancelled) setIndustriesLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

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
      const response = await analyzeResume(file, jobDescription, industry);
      if (onResult) onResult(response, file.name);
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

        <div>
          <label htmlFor="industry-select" className="block text-[11px] font-medium text-[#0F172A] mb-1">
            Industry / background <span className="text-[#64748B]">(optional)</span>
          </label>
          <select
            id="industry-select"
            value={industry}
            onChange={(e) => onIndustryChange && onIndustryChange(e.target.value)}
            disabled={loading}
            className="w-full bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-[11px] px-2.5 py-2 outline-none"
          >
            {industries.map((ind) => (
              <option key={ind.id} value={ind.id}>{ind.label}</option>
            ))}
          </select>
          {industry !== "general" && (
            <p className="text-[#0F172A] text-[10px] font-medium mt-1">
              ✓ Keyword matching will also credit {industries.find((i) => i.id === industry)?.label || industry}-specific terms.
            </p>
          )}
          {industriesLoadFailed && (
            <p className="text-[#64748B] text-[10px] mt-1">Couldn't load the full industry list — General / Tech is still available.</p>
          )}
        </div>

        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`relative border rounded-sm py-5 px-3 transition-colors duration-200 flex flex-col items-center justify-center cursor-pointer ${
            dragActive ? "border-[#0F172A] bg-[#F1F5F9]" : "border-[#E2E8F0] hover:border-[#0F172A]"
          }`}
          onClick={handleButtonClick}
        >
          <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx" onChange={handleChange} disabled={loading} />

          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="#64748B" className="w-5 h-5 mb-2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>

          <p className="text-[11px] font-medium text-[#0F172A] mb-0.5 text-center">
            Drag & drop, or <span className="text-[#2563EB] hover:underline font-semibold">browse</span>
          </p>
          <p className="text-[9px] text-[#64748B]">PDF or DOCX, max 5MB</p>
        </div>

        <div className="border border-[#E2E8F0] rounded-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowJobDescription((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-[11px] font-medium text-[#0F172A]">
              Target job description <span className="text-[#64748B]">(optional)</span>
            </span>
            <span className="text-[#64748B] text-[10px] font-medium select-none">
              {showJobDescription ? "Hide" : jobDescription ? "Edit" : "Add"}
            </span>
          </button>
          {showJobDescription && (
            <div className="px-3 pb-3 animate-fadeIn space-y-1.5">
              <textarea
                value={jobDescription}
                onChange={(e) => onJobDescriptionChange && onJobDescriptionChange(e.target.value)}
                placeholder="Paste the job posting here to get an ATS score, gap list, and rewrite tailored to this specific role instead of a generic one."
                disabled={loading}
                className="w-full min-h-[90px] bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-[11px] leading-relaxed p-2.5 resize-y outline-none placeholder:text-[#64748B]/60"
              />
              {jobDescription && jobDescription.trim() && (
                <p className="text-[#0F172A] text-[10px] font-medium">✓ Analysis will be tailored to this job description.</p>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!file || loading}
          className={`w-full py-2.5 px-3 rounded-sm font-medium text-xs transition-all duration-200 flex items-center justify-center space-x-2 ${
            !file
              ? "bg-[#E2E8F0] cursor-not-allowed text-[#64748B]"
              : loading
              ? "bg-[#0F172A]/70 cursor-wait text-white"
              : "bg-[#0F172A] hover:bg-[#2563EB] text-white"
          }`}
        >
          {loading ? (
            <>
              <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Analyzing…</span>
            </>
          ) : (
            <span>Analyze resume</span>
          )}
        </button>

        {file && (
          <div className="border border-[#E2E8F0] rounded-sm p-2 flex items-center justify-between animate-fadeIn">
            <div className="flex items-center space-x-2 overflow-hidden">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#0F172A] flex-shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              <div className="truncate text-[11px]">
                <p className="font-medium text-[#0F172A] truncate">{file.name}</p>
                <p className="text-[9px] text-[#64748B]">{formatFileSize(file.size)}</p>
              </div>
            </div>
            <button type="button" className="text-[#64748B] hover:text-[#2563EB] p-1 flex-shrink-0" onClick={() => setFile(null)} disabled={loading}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {error && (
          <div className="border border-[#2563EB]/40 bg-[#2563EB]/5 rounded-sm p-2.5 flex items-start space-x-2 text-[#0F172A] text-[11px] animate-fadeIn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 flex-shrink-0 text-[#2563EB]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}
      </form>
    </div>
  );
}