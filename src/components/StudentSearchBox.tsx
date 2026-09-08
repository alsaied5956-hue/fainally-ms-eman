import React, { useState, useEffect, useRef, useMemo } from "react";
import { Student } from "../types";
import { filterAndRankStudents } from "../utils/search";
import { Search, X, User, Phone, BookOpen, Check } from "lucide-react";

interface StudentSearchBoxProps {
  students: Student[];
  value: string;
  onChange: (val: string) => void;
  onSelectStudent?: (student: Student) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  showDropdown?: boolean;
  clearOnSelect?: boolean;
}

export const StudentSearchBox: React.FC<StudentSearchBoxProps> = ({
  students,
  value,
  onChange,
  onSelectStudent,
  placeholder = "ابحث بالاسم (مثال: أحمد علي)، الباركود، أو التليفون...",
  autoFocus = false,
  className = "",
  showDropdown = true,
  clearOnSelect = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Instant ranked suggestions
  const suggestions = useMemo(() => {
    if (!value || !value.trim()) return [];
    return filterAndRankStudents(students, value).slice(0, 8);
  }, [students, value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (student: Student) => {
    if (onSelectStudent) {
      onSelectStudent(student);
    }
    if (clearOnSelect) {
      onChange("");
    } else {
      onChange(student.name);
    }
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      if (isOpen && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex]);
      } else if (suggestions.length > 0 && onSelectStudent) {
        // If Enter pressed and only 1 top match exists, pick it
        e.preventDefault();
        handleSelect(suggestions[0]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSelectedIndex(-1);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-amber-400 absolute right-3.5 pointer-events-none transition-colors" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => {
            if (value.trim()) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="w-full bg-[#090e17] border border-amber-500/30 text-slate-100 text-xs md:text-sm pr-10 pl-9 py-2.5 rounded-xl outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 transition-all placeholder:text-slate-500 font-medium"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setIsOpen(false);
              setSelectedIndex(-1);
              inputRef.current?.focus();
            }}
            className="absolute left-2.5 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="مسح البحث"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && isOpen && value.trim() && (
        <div className="absolute top-full right-0 left-0 mt-1.5 bg-[#0f172a] border border-amber-500/40 rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-slate-800/80 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-2 bg-slate-900/90 text-[11px] font-bold text-amber-300 flex items-center justify-between border-b border-amber-500/20">
            <span>نتائج البحث الذكي ({suggestions.length})</span>
            <span className="text-slate-400 text-[10px]">استخدم الأسهم ↕ و Enter للاختيار</span>
          </div>

          {suggestions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400 italic">
              لا توجد نتائج مطابقة لـ "{value}"
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {suggestions.map((student, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={student.barcode}
                    type="button"
                    onClick={() => handleSelect(student)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-right p-2.5 flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? "bg-amber-500/20 text-amber-200"
                        : "hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-slate-100 truncate flex items-center gap-1.5">
                          {student.name}
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 inline" />}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span className="flex items-center gap-0.5 text-amber-300/90">
                            <BookOpen className="w-3 h-3" />
                            {student.groupGrade}
                          </span>
                          <span>•</span>
                          <span>{student.groupDays}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <span className="font-mono text-[11px] bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-amber-300">
                        #{student.barcode}
                      </span>
                      {student.parentPhone && (
                        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-1">
                          <Phone className="w-2.5 h-2.5 text-emerald-400" />
                          {student.parentPhone}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
