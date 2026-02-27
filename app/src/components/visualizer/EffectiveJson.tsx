import type { EffectiveConfig } from "@/lib/ipc/effective";

interface EffectiveJsonProps {
  config: EffectiveConfig;
}

export function EffectiveJson({ config }: EffectiveJsonProps) {
  const json = JSON.stringify(config.settings, null, 2);

  return (
    <div className="relative">
      <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono leading-relaxed text-foreground/90 max-h-[70vh]">
        {json}
      </pre>
    </div>
  );
}
