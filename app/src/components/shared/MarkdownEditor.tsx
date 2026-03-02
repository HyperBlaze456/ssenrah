import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { marked } from "marked";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  disabled?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = "200px",
  disabled = false,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (mode === "write" && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, parseInt(minHeight))}px`;
    }
  }, [value, mode, minHeight]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab inserts 2 spaces instead of moving focus
      if (e.key === "Tab") {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const newValue = value.slice(0, start) + "  " + value.slice(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + 2;
        });
      }
    },
    [value, onChange],
  );

  const renderedHtml = useMemo(() => {
    if (mode !== "preview") return "";
    try {
      return marked.parse(value || "*Nothing to preview*", {
        breaks: true,
        gfm: true,
      }) as string;
    } catch {
      return "<p>Failed to render preview.</p>";
    }
  }, [value, mode]);

  return (
    <div className="rounded-md border border-input bg-background overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-input bg-muted/30 px-1">
        <button
          type="button"
          onClick={() => setMode("write")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
            mode === "write"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Write
          {mode === "write" && (
            <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
            mode === "preview"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Preview
          {mode === "preview" && (
            <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />
          )}
        </button>
      </div>

      {/* Content area */}
      {mode === "write" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          className="w-full resize-none bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          style={{ minHeight }}
        />
      ) : (
        <div
          className="markdown-preview px-3 py-2 text-sm leading-relaxed"
          style={{ minHeight }}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
    </div>
  );
}
