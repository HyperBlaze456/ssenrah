import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, X } from "lucide-react";
import type { HookEvent, HookGroup, HookDefinition } from "@/types";

const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "UserPromptSubmit", "Notification",
  "Stop", "SubagentStart", "SubagentStop",
  "SessionStart", "SessionEnd", "TeammateIdle",
  "TaskCompleted", "PreCompact",
];

interface HookEditorProps {
  hooks: Partial<Record<HookEvent, HookGroup[]>>;
  onChange: (hooks: Partial<Record<HookEvent, HookGroup[]>>) => void;
  readOnly?: boolean;
}

export function HookEditor({ hooks, onChange, readOnly }: HookEditorProps) {
  const [selectedEvent, setSelectedEvent] = useState<HookEvent | "">("");

  const configuredEvents = Object.keys(hooks).filter(
    (ev) => hooks[ev as HookEvent] && hooks[ev as HookEvent]!.length > 0,
  ) as HookEvent[];

  const addEvent = () => {
    if (!selectedEvent) return;
    const existing = hooks[selectedEvent] ?? [];
    onChange({
      ...hooks,
      [selectedEvent]: [...existing, { hooks: [{ type: "command", command: "" }] }],
    });
    setSelectedEvent("");
  };

  const removeEvent = (event: HookEvent) => {
    const next = { ...hooks };
    delete next[event];
    onChange(next);
  };

  const updateGroups = (event: HookEvent, groups: HookGroup[]) => {
    onChange({ ...hooks, [event]: groups });
  };

  const addGroup = (event: HookEvent) => {
    const groups = hooks[event] ?? [];
    updateGroups(event, [...groups, { hooks: [{ type: "command", command: "" }] }]);
  };

  const removeGroup = (event: HookEvent, groupIdx: number) => {
    const groups = hooks[event] ?? [];
    const updated = groups.filter((_, i) => i !== groupIdx);
    if (updated.length === 0) {
      removeEvent(event);
    } else {
      updateGroups(event, updated);
    }
  };

  const updateGroupMatcher = (event: HookEvent, groupIdx: number, matcher: string) => {
    const groups = [...(hooks[event] ?? [])];
    groups[groupIdx] = { ...groups[groupIdx], matcher: matcher || undefined };
    updateGroups(event, groups);
  };

  const addHook = (event: HookEvent, groupIdx: number) => {
    const groups = [...(hooks[event] ?? [])];
    groups[groupIdx] = {
      ...groups[groupIdx],
      hooks: [...groups[groupIdx].hooks, { type: "command", command: "" }],
    };
    updateGroups(event, groups);
  };

  const removeHook = (event: HookEvent, groupIdx: number, hookIdx: number) => {
    const groups = [...(hooks[event] ?? [])];
    const updatedHooks = groups[groupIdx].hooks.filter((_, i) => i !== hookIdx);
    if (updatedHooks.length === 0) {
      removeGroup(event, groupIdx);
    } else {
      groups[groupIdx] = { ...groups[groupIdx], hooks: updatedHooks };
      updateGroups(event, groups);
    }
  };

  const updateHook = (
    event: HookEvent,
    groupIdx: number,
    hookIdx: number,
    updates: Partial<HookDefinition>,
  ) => {
    const groups = [...(hooks[event] ?? [])];
    const hooksArr = [...groups[groupIdx].hooks];
    hooksArr[hookIdx] = { ...hooksArr[hookIdx], ...updates };
    groups[groupIdx] = { ...groups[groupIdx], hooks: hooksArr };
    updateGroups(event, groups);
  };

  return (
    <div className="space-y-6">
      {/* Add event selector */}
      {!readOnly && (
        <div className="flex gap-2">
          <Select
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value as HookEvent | "")}
            className="flex-1"
          >
            <option value="">Select hook event...</option>
            {HOOK_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={addEvent}
            disabled={!selectedEvent}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Event
          </Button>
        </div>
      )}

      {/* Configured events */}
      {configuredEvents.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No hooks configured. Select an event above to add hook groups.
        </p>
      )}

      {configuredEvents.map((event) => {
        const groups = hooks[event] ?? [];
        return (
          <Card key={event}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">{event}</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {groups.length} group{groups.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addGroup(event)}
                      className="h-7 px-2 text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Group
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEvent(event)}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0 space-y-4">
              {groups.map((group, groupIdx) => (
                <div
                  key={groupIdx}
                  className="rounded border border-border p-3 space-y-3"
                >
                  {/* Group header */}
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Group {groupIdx + 1}
                    </Label>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeGroup(event, groupIdx)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  {/* Matcher */}
                  <div className="space-y-1">
                    <Label className="text-xs">Matcher (regex, optional)</Label>
                    <Input
                      value={group.matcher ?? ""}
                      onChange={(e) => updateGroupMatcher(event, groupIdx, e.target.value)}
                      placeholder="e.g. Bash|Read"
                      className="font-mono text-sm"
                      disabled={readOnly}
                    />
                  </div>

                  <Separator />

                  {/* Hooks in group */}
                  {group.hooks.map((hook, hookIdx) => (
                    <HookRow
                      key={hookIdx}
                      hook={hook}
                      readOnly={readOnly}
                      onChange={(updates) => updateHook(event, groupIdx, hookIdx, updates)}
                      onRemove={() => removeHook(event, groupIdx, hookIdx)}
                    />
                  ))}

                  {!readOnly && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addHook(event, groupIdx)}
                      className="text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Hook
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface HookRowProps {
  hook: HookDefinition;
  readOnly?: boolean;
  onChange: (updates: Partial<HookDefinition>) => void;
  onRemove: () => void;
}

function HookRow({ hook, readOnly, onChange, onRemove }: HookRowProps) {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-muted/30 p-2">
      <div className="flex-1 space-y-2">
        <div className="flex gap-2">
          <Select
            value={hook.type}
            onChange={(e) => {
              const type = e.target.value as HookDefinition["type"];
              onChange({
                type,
                command: type === "command" ? hook.command ?? "" : undefined,
                prompt: type === "prompt" || type === "agent" ? hook.prompt ?? "" : undefined,
              });
            }}
            disabled={readOnly}
            className="w-28"
          >
            <option value="command">command</option>
            <option value="prompt">prompt</option>
            <option value="agent">agent</option>
          </Select>

          {hook.type === "command" && (
            <Input
              value={hook.command ?? ""}
              onChange={(e) => onChange({ command: e.target.value })}
              placeholder="shell command"
              className="flex-1 font-mono text-sm"
              disabled={readOnly}
            />
          )}

          {(hook.type === "prompt" || hook.type === "agent") && (
            <Input
              value={hook.prompt ?? ""}
              onChange={(e) => onChange({ prompt: e.target.value })}
              placeholder={hook.type === "prompt" ? "prompt text" : "agent prompt"}
              className="flex-1 font-mono text-sm"
              disabled={readOnly}
            />
          )}
        </div>

        <div className="flex gap-2 items-center">
          <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
          <Input
            value={hook.timeout ?? ""}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              onChange({ timeout: val });
            }}
            placeholder="60000"
            type="number"
            className="w-32 font-mono text-sm"
            disabled={readOnly}
          />
        </div>
      </div>

      {!readOnly && (
        <button
          onClick={onRemove}
          className="mt-1 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
