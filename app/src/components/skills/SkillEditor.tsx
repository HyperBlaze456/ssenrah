import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select } from "@/components/ui/select";
import { SkillFrontmatterSchema } from "@/lib/schemas/skills";
import { useSkillsStore } from "@/lib/store/skills";
import { Save, X } from "lucide-react";

interface SkillEditorProps {
  scope: string;
  directory: string | null;
  onClose: () => void;
}

const EMPTY_FRONTMATTER: Record<string, unknown> = {};

export function SkillEditor({ scope, directory, onClose }: SkillEditorProps) {
  const selected = useSkillsStore((s) => s.selected);
  const detailStatus = useSkillsStore((s) => s.detailStatus);
  const loadDetail = useSkillsStore((s) => s.loadDetail);
  const saveSkill = useSkillsStore((s) => s.saveSkill);

  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(EMPTY_FRONTMATTER);
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (directory) {
      loadDetail(scope, directory);
    } else {
      setFrontmatter({ ...EMPTY_FRONTMATTER });
      setBody("");
    }
  }, [scope, directory, loadDetail]);

  useEffect(() => {
    if (selected && directory) {
      setFrontmatter({ ...selected.frontmatter });
      setBody(selected.body);
    }
  }, [selected, directory]);

  const updateField = (key: string, value: unknown) => {
    setFrontmatter((prev) => {
      const next = { ...prev };
      if (value === "" || value === undefined || value === false) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    const result = SkillFrontmatterSchema.safeParse(frontmatter);
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
      const targetDir = directory ?? (frontmatter.name as string) ?? "new-skill";
      await saveSkill(scope, targetDir, frontmatter, body);
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setSaving(false);
    }
  };

  if (directory && detailStatus.state === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Loading skill...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {directory ? "Edit Skill" : "New Skill"}
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

      <div className="grid gap-4">
        {/* Name */}
        <div className="space-y-1">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={(frontmatter.name as string) ?? ""}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="my-skill"
            className="font-mono text-sm"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Display name for the skill (used as /command name).
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label htmlFor="skill-description">Description</Label>
          <Input
            id="skill-description"
            value={(frontmatter.description as string) ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="What this skill does"
          />
          {errors.description && (
            <p className="text-xs text-destructive">{errors.description}</p>
          )}
        </div>

        {/* Argument Hint */}
        <div className="space-y-1">
          <Label htmlFor="skill-argument-hint">Argument Hint</Label>
          <Input
            id="skill-argument-hint"
            value={(frontmatter["argument-hint"] as string) ?? ""}
            onChange={(e) => updateField("argument-hint", e.target.value)}
            placeholder="<file-path>"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Hint shown after the slash command name.
          </p>
        </div>

        {/* Model */}
        <div className="space-y-1">
          <Label htmlFor="skill-model">Model</Label>
          <Input
            id="skill-model"
            value={(frontmatter.model as string) ?? ""}
            onChange={(e) => updateField("model", e.target.value)}
            placeholder="Default model"
            className="font-mono text-sm"
          />
        </div>

        {/* Allowed Tools */}
        <div className="space-y-1">
          <Label htmlFor="skill-allowed-tools">Allowed Tools</Label>
          <Input
            id="skill-allowed-tools"
            value={(frontmatter["allowed-tools"] as string) ?? ""}
            onChange={(e) => updateField("allowed-tools", e.target.value)}
            placeholder="Bash, Read, Edit, ..."
            className="font-mono text-sm"
          />
        </div>

        {/* Agent */}
        <div className="space-y-1">
          <Label htmlFor="skill-agent">Agent</Label>
          <Input
            id="skill-agent"
            value={(frontmatter.agent as string) ?? ""}
            onChange={(e) => updateField("agent", e.target.value)}
            placeholder="agent-name"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Run this skill as a specific agent type.
          </p>
        </div>

        {/* Context */}
        <div className="space-y-1">
          <Label htmlFor="skill-context">Context</Label>
          <Select
            id="skill-context"
            value={(frontmatter.context as string) ?? ""}
            onChange={(e) => updateField("context", e.target.value || undefined)}
          >
            <option value="">Inherit</option>
            <option value="fork">Fork</option>
          </Select>
          <p className="text-xs text-muted-foreground">
            "fork" creates an isolated conversation context.
          </p>
        </div>

        {/* Disable Model Invocation */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Disable Model Invocation</Label>
            <p className="text-xs text-muted-foreground">
              Prevent the model from invoking this skill directly.
            </p>
          </div>
          <Switch
            checked={(frontmatter["disable-model-invocation"] as boolean) ?? false}
            onCheckedChange={(v) => updateField("disable-model-invocation", v || undefined)}
          />
        </div>

        {/* User Invocable */}
        <div className="flex items-center justify-between">
          <div>
            <Label>User Invocable</Label>
            <p className="text-xs text-muted-foreground">
              Allow users to invoke this skill via slash command.
            </p>
          </div>
          <Switch
            checked={(frontmatter["user-invocable"] as boolean) ?? false}
            onCheckedChange={(v) => updateField("user-invocable", v || undefined)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Skill Prompt (Markdown Body)</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe what this skill does and how it should behave..."
          className="min-h-[200px] font-mono text-sm resize-y"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
