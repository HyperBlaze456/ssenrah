import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { ListEditor } from "@/components/shared/ListEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WritableScope } from "@/types";

export function DisplayPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const status = useSettingsStore((s) => s.status[scope]);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);
  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(scope)} />;
  }

  if (settings === null) {
    return <EmptyState scope={scope} panelName="Model & Display" />;
  }

  const spinnerTipsOverride = settings?.spinnerTipsOverride ?? {};
  const spinnerVerbs = settings?.spinnerVerbs ?? {};
  const attribution = settings?.attribution ?? {};

  return (
    <div className="space-y-6">
      {/* Model */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Model</h3>
        <div className="space-y-1">
          <Label htmlFor="model">Active Model</Label>
          <Input
            id="model"
            value={settings?.model ?? ""}
            onChange={(e) => update(writableScope, "model", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="e.g. claude-sonnet-4-20250514"
            className="font-mono text-sm"
          />
        </div>
      </div>

      {/* Available Models */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Available Models</h3>
        <p className="text-xs text-muted-foreground">
          Models offered in the model selector. Leave empty to use defaults.
        </p>
        <ListEditor
          items={settings?.availableModels ?? []}
          onChange={(models) => update(writableScope, "availableModels", models.length > 0 ? models : undefined)}
          placeholder="Model ID (e.g. claude-sonnet-4-20250514)"
          readOnly={readOnly}
          addLabel="Add Model"
        />
      </div>

      <Separator />

      {/* Output & Language */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Output & Language</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="outputStyle">Output Style</Label>
            <Input
              id="outputStyle"
              value={settings?.outputStyle ?? ""}
              onChange={(e) => update(writableScope, "outputStyle", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="e.g. concise, verbose"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="language">Language</Label>
            <Input
              id="language"
              value={settings?.language ?? ""}
              onChange={(e) => update(writableScope, "language", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="e.g. en, ja, zh"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Boolean Toggles */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Display Toggles</h3>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.respectGitignore ?? false}
            onCheckedChange={(checked) => update(writableScope, "respectGitignore", checked)}
            disabled={readOnly}
          />
          <Label>Respect .gitignore</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.prefersReducedMotion ?? false}
            onCheckedChange={(checked) => update(writableScope, "prefersReducedMotion", checked)}
            disabled={readOnly}
          />
          <Label>Prefers reduced motion</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.spinnerTipsEnabled ?? false}
            onCheckedChange={(checked) => update(writableScope, "spinnerTipsEnabled", checked)}
            disabled={readOnly}
          />
          <Label>Spinner tips enabled</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.terminalProgressBarEnabled ?? false}
            onCheckedChange={(checked) => update(writableScope, "terminalProgressBarEnabled", checked)}
            disabled={readOnly}
          />
          <Label>Terminal progress bar enabled</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.showTurnDuration ?? false}
            onCheckedChange={(checked) => update(writableScope, "showTurnDuration", checked)}
            disabled={readOnly}
          />
          <Label>Show turn duration</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.alwaysThinkingEnabled ?? false}
            onCheckedChange={(checked) => update(writableScope, "alwaysThinkingEnabled", checked)}
            disabled={readOnly}
          />
          <Label>Always thinking enabled</Label>
        </div>
      </div>

      <Separator />

      {/* Spinner Tips Override */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Spinner Tips Override</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={spinnerTipsOverride.excludeDefault ?? false}
              onCheckedChange={(checked) =>
                update(writableScope, "spinnerTipsOverride.excludeDefault", checked)
              }
              disabled={readOnly}
            />
            <Label>Exclude default tips</Label>
          </div>
          <div className="space-y-2">
            <Label>Custom Tips</Label>
            <ListEditor
              items={spinnerTipsOverride.tips ?? []}
              onChange={(tips) => update(writableScope, "spinnerTipsOverride.tips", tips.length > 0 ? tips : undefined)}
              placeholder="Add a spinner tip..."
              readOnly={readOnly}
              addLabel="Add Tip"
            />
          </div>
        </CardContent>
      </Card>

      {/* Spinner Verbs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Spinner Verbs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="spinnerVerbsMode">Mode</Label>
            <Select
              id="spinnerVerbsMode"
              value={spinnerVerbs.mode ?? ""}
              onChange={(e) =>
                update(writableScope, "spinnerVerbs.mode", e.target.value || undefined)
              }
              disabled={readOnly}
              className="w-48"
            >
              <option value="">Not set</option>
              <option value="append">Append</option>
              <option value="replace">Replace</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Verbs</Label>
            <ListEditor
              items={spinnerVerbs.verbs ?? []}
              onChange={(verbs) => update(writableScope, "spinnerVerbs.verbs", verbs.length > 0 ? verbs : undefined)}
              placeholder="Add a spinner verb..."
              readOnly={readOnly}
              addLabel="Add Verb"
            />
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Attribution */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Attribution</h3>
          <p className="text-xs text-muted-foreground">
            Templates appended to commit messages and PR descriptions.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="attributionCommit">Commit Template</Label>
          <Input
            id="attributionCommit"
            value={attribution.commit ?? ""}
            onChange={(e) => update(writableScope, "attribution.commit", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="e.g. Generated by Claude Code"
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="attributionPr">PR Template</Label>
          <Input
            id="attributionPr"
            value={attribution.pr ?? ""}
            onChange={(e) => update(writableScope, "attribution.pr", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="e.g. This PR was generated by Claude Code"
            className="font-mono text-sm"
          />
        </div>
      </div>

      <Separator />

      {/* StatusLine & FileSuggestion */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Custom Commands</h3>
          <p className="text-xs text-muted-foreground">
            Shell commands used by Claude Code to populate the status line and file suggestions.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="statusLineCommand">StatusLine Command</Label>
          <Input
            id="statusLineCommand"
            value={settings?.statusLine?.command ?? ""}
            onChange={(e) =>
              update(
                writableScope,
                "statusLine",
                e.target.value ? { type: "command" as const, command: e.target.value } : undefined,
              )
            }
            disabled={readOnly}
            placeholder="Shell command for status line"
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fileSuggestionCommand">FileSuggestion Command</Label>
          <Input
            id="fileSuggestionCommand"
            value={settings?.fileSuggestion?.command ?? ""}
            onChange={(e) =>
              update(
                writableScope,
                "fileSuggestion",
                e.target.value ? { type: "command" as const, command: e.target.value } : undefined,
              )
            }
            disabled={readOnly}
            placeholder="Shell command for file suggestions"
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}
