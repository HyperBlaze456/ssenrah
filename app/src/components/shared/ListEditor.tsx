import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus, GripVertical } from "lucide-react";

interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  validate?: (item: string) => { valid: boolean; error?: string };
  readOnly?: boolean;
  addLabel?: string;
}

export function ListEditor({
  items,
  onChange,
  placeholder = "Add item...",
  validate,
  readOnly,
  addLabel = "Add",
}: ListEditorProps) {
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (validate) {
      const result = validate(trimmed);
      if (!result.valid) {
        setError(result.error ?? "Invalid");
        return;
      }
    }
    onChange([...items, trimmed]);
    setNewItem("");
    setError(null);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span className="flex-1 text-sm font-mono">{item}</span>
          {!readOnly && (
            <button
              onClick={() => handleRemove(index)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(e) => {
              setNewItem(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 font-mono text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {addLabel}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">No items configured.</p>
      )}
    </div>
  );
}
