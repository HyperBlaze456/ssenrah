import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { X, Plus, GripVertical } from "lucide-react";
import { KNOWN_TOOLS } from "@/lib/schemas/permissions";
import { cn } from "@/lib/utils";

interface RuleBuilderProps {
  rules: string[];
  category: "allow" | "ask" | "deny";
  onChange: (rules: string[]) => void;
  readOnly?: boolean;
}

const CATEGORY_COLORS = {
  allow: "border-l-green-500",
  ask: "border-l-yellow-500",
  deny: "border-l-red-500",
};

export function RuleBuilder({
  rules,
  category,
  onChange,
  readOnly,
}: RuleBuilderProps) {
  const [tool, setTool] = useState("");
  const [specifier, setSpecifier] = useState("");

  const handleAdd = () => {
    if (!tool) return;
    const rule = specifier ? `${tool}(${specifier})` : tool;
    onChange([...rules, rule]);
    setTool("");
    setSpecifier("");
  };

  const handleRemove = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {rules.map((rule, index) => (
        <div
          key={index}
          className={cn(
            "flex items-center gap-2 rounded border border-border border-l-2 bg-muted/30 px-2 py-1.5",
            CATEGORY_COLORS[category],
          )}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span className="flex-1 font-mono text-sm">{rule}</span>
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
          <Select
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            className="w-40"
          >
            <option value="">Select tool...</option>
            {KNOWN_TOOLS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input
            value={specifier}
            onChange={(e) => setSpecifier(e.target.value)}
            placeholder="specifier (optional)"
            className="flex-1 font-mono text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={!tool}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      )}
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No {category} rules configured.
        </p>
      )}
    </div>
  );
}
