import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus, Eye, EyeOff } from "lucide-react";

interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  keyAutocomplete?: string[];
  maskValues?: boolean;
  readOnly?: boolean;
}

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  keyAutocomplete,
  maskValues,
  readOnly,
}: KeyValueEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showValues, setShowValues] = useState(!maskValues);
  const pairs = Object.entries(entries);

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...entries, [k]: newValue });
    setNewKey("");
    setNewValue("");
  };

  const handleRemove = (key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  };

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  return (
    <div className="space-y-2">
      {maskValues && (
        <button
          onClick={() => setShowValues(!showValues)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showValues ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
          {showValues ? "Hide values" : "Show values"}
        </button>
      )}
      {pairs.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <Input
            value={key}
            readOnly
            className="w-48 font-mono text-sm bg-muted/30"
          />
          <Input
            value={showValues ? value : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
            onChange={(e) => handleValueChange(key, e.target.value)}
            readOnly={readOnly || !showValues}
            className="flex-1 font-mono text-sm"
          />
          {!readOnly && (
            <button
              onClick={() => handleRemove(key)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={keyPlaceholder}
            list={keyAutocomplete ? "kv-autocomplete" : undefined}
            className="w-48 font-mono text-sm"
          />
          {keyAutocomplete && (
            <datalist id="kv-autocomplete">
              {keyAutocomplete.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          )}
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1 font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={!newKey.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      )}
      {pairs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No entries configured.
        </p>
      )}
    </div>
  );
}
