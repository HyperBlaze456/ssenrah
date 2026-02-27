import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select } from "@/components/ui/select";
import { AgentFrontmatterSchema } from "@/lib/schemas/agents";
import { useAgentsStore } from "@/lib/store/agents";
import { Save, X } from "lucide-react";

interface AgentEditorProps {
  scope: string;
  filename: string | null;
  onClose: () => void;
}

const EMPTY_FRONTMATTER: Record<string, unknown> = {
  name: "",
  description: "",
};

export function AgentEditor({ scope, filename, onClose }: AgentEditorProps) {
  const selected = useAgentsStore((s) => s.selected);
  const detailStatus = useAgentsStore((s) => s.detailStatus);
  const loadDetail = useAgentsStore((s) => s.loadDetail);
  const saveAgent = useAgentsStore((s) => s.saveAgent);

  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(EMPTY_FRONTMATTER);
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Load agent detail when filename changes
  useEffect(() => {
    if (filename) {
      loadDetail(scope, filename);
    } else {
      setFrontmatter({ ...EMPTY_FRONTMATTER });
      setBody("");
    }
  }, [scope, filename, loadDetail]);

  // Sync loaded detail into local state
  useEffect(() => {
    if (selected && filename) {
      setFrontmatter({ ...selected.frontmatter });
      setBody(selected.body);
    }
  }, [selected, filename]);

  const updateField = (key: string, value: unknown) => {
    setFrontmatter((prev) => {
      const next = { ...prev };
      if (value === "" || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    const result = AgentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const name = frontmatter.name as string;
      const targetFilename = filename ?? `${name}.md`;
      await saveAgent(scope, targetFilename, frontmatter, body);
      onClose();
    } catch {
      // Error will be handled by the store
    } finally {
      setSaving(false);
    }
  };

  if (filename && detailStatus.state === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Loading agent...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with save/cancel */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {filename ? "Edit Agent" : "New Agent"}
        </h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="mr-1 h-3 w-3" /> Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="mr-1 h-3 w-3" /> {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Frontmatter fields */}
      <div className="grid gap-4">
        {/* Name */}
        <div className="space-y-1">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={(frontmatter.name as string) ?? ""}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="my-agent"
            className="font-mono text-sm"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Lowercase with hyphens. Used as the agent identifier.
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label htmlFor="agent-description">Description</Label>
          <Input
            id="agent-description"
            value={(frontmatter.description as string) ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="What this agent does"
          />
          {errors.description && (
            <p className="text-xs text-destructive">{errors.description}</p>
          )}
        </div>

        {/* Model */}
        <div className="space-y-1">
          <Label htmlFor="agent-model">Model</Label>
          <Select
            id="agent-model"
            value={(frontmatter.model as string) ?? ""}
            onChange={(e) => updateField("model", e.target.value || undefined)}
          >
            <option value="">Inherit from parent</option>
            <option value="inherit">Inherit</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </Select>
        </div>

        {/* Tools */}
        <div className="space-y-1">
          <Label htmlFor="agent-tools">Allowed Tools</Label>
          <Input
            id="agent-tools"
            value={(frontmatter.tools as string) ?? ""}
            onChange={(e) => updateField("tools", e.target.value)}
            placeholder="mcp__*, Bash, Read, Edit, ..."
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated tool names or glob patterns.
          </p>
        </div>

        {/* Disallowed Tools */}
        <div className="space-y-1">
          <Label htmlFor="agent-disallowed-tools">Disallowed Tools</Label>
          <Input
            id="agent-disallowed-tools"
            value={(frontmatter.disallowedTools as string) ?? ""}
            onChange={(e) => updateField("disallowedTools", e.target.value)}
            placeholder="WebSearch, ..."
            className="font-mono text-sm"
          />
        </div>

        {/* Permission Mode */}
        <div className="space-y-1">
          <Label htmlFor="agent-permission-mode">Permission Mode</Label>
          <Select
            id="agent-permission-mode"
            value={(frontmatter.permissionMode as string) ?? ""}
            onChange={(e) => updateField("permissionMode", e.target.value || undefined)}
          >
            <option value="">Default</option>
            <option value="default">Default</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="dontAsk">Don't Ask</option>
            <option value="bypassPermissions">Bypass Permissions</option>
            <option value="plan">Plan</option>
          </Select>
        </div>

        {/* Max Turns */}
        <div className="space-y-1">
          <Label htmlFor="agent-max-turns">Max Turns</Label>
          <Input
            id="agent-max-turns"
            type="number"
            min={1}
            max={100}
            value={frontmatter.maxTurns !== undefined ? String(frontmatter.maxTurns) : ""}
            onChange={(e) => {
              const v = e.target.value;
              updateField("maxTurns", v ? parseInt(v, 10) : undefined);
            }}
            placeholder="Unlimited"
          />
          {errors.maxTurns && (
            <p className="text-xs text-destructive">{errors.maxTurns}</p>
          )}
        </div>

        {/* Background */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Background</Label>
            <p className="text-xs text-muted-foreground">
              Run this agent in the background.
            </p>
          </div>
          <Switch
            checked={(frontmatter.background as boolean) ?? false}
            onCheckedChange={(v) => updateField("background", v || undefined)}
          />
        </div>

        {/* Isolation */}
        <div className="space-y-1">
          <Label htmlFor="agent-isolation">Isolation</Label>
          <Select
            id="agent-isolation"
            value={(frontmatter.isolation as string) ?? ""}
            onChange={(e) => updateField("isolation", e.target.value || undefined)}
          >
            <option value="">None</option>
            <option value="worktree">Worktree</option>
          </Select>
        </div>

        {/* Memory */}
        <div className="space-y-1">
          <Label htmlFor="agent-memory">Memory Scope</Label>
          <Select
            id="agent-memory"
            value={(frontmatter.memory as string) ?? ""}
            onChange={(e) => updateField("memory", e.target.value || undefined)}
          >
            <option value="">None</option>
            <option value="user">User</option>
            <option value="project">Project</option>
            <option value="local">Local</option>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Body / Prompt */}
      <div className="space-y-2">
        <Label>Agent Prompt (Markdown Body)</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe the agent's behavior and instructions..."
          className="min-h-[200px] font-mono text-sm resize-y"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
