import { useEffect, useState } from "react";
import { useEffectiveStore } from "@/lib/store/effective";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EffectiveStructured } from "./EffectiveStructured";
import { EffectiveJson } from "./EffectiveJson";
import { EffectiveDiff } from "./EffectiveDiff";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ViewMode = "structured" | "json" | "overrides";

export function EffectivePanel() {
  const config = useEffectiveStore((s) => s.config);
  const loading = useEffectiveStore((s) => s.loading);
  const recompute = useEffectiveStore((s) => s.recompute);
  const [viewMode, setViewMode] = useState<ViewMode>("structured");

  useEffect(() => {
    recompute();
  }, [recompute]);

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center gap-2 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Computing effective config...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to compute effective configuration.
        </p>
        <Button variant="outline" size="sm" onClick={recompute}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  const overrideCount = config.overrides.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="structured">Structured</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="overrides">
              Overrides{overrideCount > 0 ? ` (${overrideCount})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="structured">
            <EffectiveStructured config={config} />
          </TabsContent>

          <TabsContent value="json">
            <EffectiveJson config={config} />
          </TabsContent>

          <TabsContent value="overrides">
            <EffectiveDiff config={config} />
          </TabsContent>
        </Tabs>

        <Button
          variant="ghost"
          size="sm"
          onClick={recompute}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}
