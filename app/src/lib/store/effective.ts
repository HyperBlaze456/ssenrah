import { create } from "zustand";
import type { EffectiveConfig } from "@/lib/ipc/effective";
import { computeEffectiveConfig } from "@/lib/ipc/effective";

interface EffectiveStore {
  config: EffectiveConfig | null;
  loading: boolean;
  recompute: () => Promise<void>;
}

export const useEffectiveStore = create<EffectiveStore>((set) => ({
  config: null,
  loading: false,
  recompute: async () => {
    set({ loading: true });
    try {
      const config = await computeEffectiveConfig();
      set({ config, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
