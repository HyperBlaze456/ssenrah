import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PluginDetailViewProps {
  name: string;
  enabled: boolean;
}

export function PluginDetailView({ name, enabled }: PluginDetailViewProps) {
  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm">Plugin Details</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Name:</span>
          <span className="text-sm font-mono">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <Badge variant={enabled ? "default" : "secondary"}>
            {enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
