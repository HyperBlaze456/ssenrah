import { useEffect } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { MainContent } from "./MainContent";
import { useProjectStore } from "@/lib/store/project";
import { useSettingsStore } from "@/lib/store/settings";

export function AppLayout() {
  const initialize = useProjectStore((s) => s.initialize);
  const loadAll = useSettingsStore((s) => s.loadAll);

  useEffect(() => {
    initialize().then(() => loadAll());
  }, [initialize, loadAll]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
}
