import React, { useEffect, useState } from "react";

/**
 * Reusable FixModal component.
 * Features an overlay that closes on backdrop click/Escape key,
 * custom scrollable area, and smooth fade-in animation.
 */
export default function FixModal({ isOpen, onClose, title, children, footer }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setMounted(true), 10);
      return () => clearTimeout(timer);
    } else {
      setMounted(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 bg-black/70 flex items-center justify-center z-[5000] p-4 transition-opacity duration-200 ${
        mounted ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[860px] bg-[#432818] border border-[#99582a] rounded-[20px] p-8 flex flex-col max-h-[90vh] shadow-2xl animate-fadeIn"
      >
        {/* Header Row */}
        <div className="flex items-center justify-between border-b border-[#99582a]/30 pb-4 mb-5">
          <h3 className="text-[#ffe6a7] font-bold text-[20px]">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-[#99582a] hover:text-[#ffe6a7] transition-colors text-lg font-bold p-1 select-none"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="overflow-y-auto max-h-[70vh] pr-2 text-[#ffe6a7]">
          {children}
        </div>

        {/* Footer Row */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-[#99582a]/30 pt-5 mt-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
