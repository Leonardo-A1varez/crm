"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { VARIABLES_DISPONIBLES, type Variable } from "./VariableSelector";

interface TextareaConVariablesProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
}

export function TextareaConVariables({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  className,
}: TextareaConVariablesProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  const filteredVariables = VARIABLES_DISPONIBLES.filter((v) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q);
  });

  const calculateDropdownPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lines = textBeforeCursor.split("\n");
    const currentLine = lines.length - 1;
    const currentLineText = lines[currentLine] ?? "";

    const lineHeight = 20;
    const charWidth = 7;

    const top = (currentLine + 1) * lineHeight + 4;
    const left = Math.min(currentLineText.length * charWidth, 200);

    setDropdownPosition({ top, left });
  }, [value]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      onChange(newValue);

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const lastOpenBrace = textBeforeCursor.lastIndexOf("{{");
      const lastCloseBrace = textBeforeCursor.lastIndexOf("}}");

      if (lastOpenBrace > lastCloseBrace) {
        const filterText = textBeforeCursor.slice(lastOpenBrace + 2);
        if (!filterText.includes(" ") && filterText.length < 30) {
          setFilter(filterText);
          setShowDropdown(true);
          setSelectedIndex(0);
          calculateDropdownPosition();
        } else {
          setShowDropdown(false);
        }
      } else {
        setShowDropdown(false);
      }
    },
    [onChange, calculateDropdownPosition],
  );

  const insertVariable = useCallback(
    (variable: Variable) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);
      const lastOpenBrace = textBeforeCursor.lastIndexOf("{{");

      if (lastOpenBrace === -1) return;

      const textAfterCursor = value.slice(cursorPos);
      const newValue = value.slice(0, lastOpenBrace) + `{{${variable.key}}}` + textAfterCursor;

      onChange(newValue);
      setShowDropdown(false);
      setFilter("");

      setTimeout(() => {
        if (textarea) {
          const newPos = lastOpenBrace + variable.key.length + 4;
          textarea.setSelectionRange(newPos, newPos);
          textarea.focus();
        }
      }, 0);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showDropdown) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < filteredVariables.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredVariables.length - 1));
          break;
        case "Enter":
        case "Tab":
          if (filteredVariables[selectedIndex]) {
            e.preventDefault();
            insertVariable(filteredVariables[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setShowDropdown(false);
          break;
      }
    },
    [showDropdown, filteredVariables, selectedIndex, insertVariable],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selected = dropdownRef.current.querySelector("[data-selected=true]");
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, showDropdown]);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={className}
      />

      {maxLength && (
        <div className="text-ink-faint mt-1 text-right text-[10px]">
          {value.length}/{maxLength} caracteres
        </div>
      )}

      {showDropdown && filteredVariables.length > 0 && (
        <div
          ref={dropdownRef}
          className="border-line-control bg-surface-panel absolute z-50 max-h-[200px] min-w-[280px] overflow-auto rounded-md border shadow-lg"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
          }}
        >
          <div className="p-1">
            {filteredVariables.map((v, idx) => (
              <button
                key={v.key}
                type="button"
                data-selected={idx === selectedIndex}
                onClick={() => insertVariable(v)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] ${
                  idx === selectedIndex
                    ? "bg-accent-blue/20 text-ink-primary"
                    : "text-ink-secondary hover:bg-surface-hover"
                }`}
              >
                <code className="text-accent-blue font-mono">{`{{${v.key}}}`}</code>
                <span className="text-ink-faint ml-3">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
