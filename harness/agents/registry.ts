import type { AgentType } from "./agent-types";

/**
 * Simple Map-based registry for predefined agent types.
 *
 * Register types at startup, look them up by name when spawning.
 */
export class AgentTypeRegistry {
  private types = new Map<string, AgentType>();

  /**
   * Register an agent type. Overwrites if same name already registered.
   */
  register(type: AgentType): this {
    if (!type.name || !type.name.trim()) {
      throw new Error("AgentType must have a non-empty name");
    }
    this.types.set(type.name.trim(), { ...type, name: type.name.trim() });
    return this;
  }

  /**
   * Look up an agent type by name.
   */
  get(name: string): AgentType | undefined {
    return this.types.get(name.trim());
  }

  /**
   * List all registered agent types.
   */
  list(): AgentType[] {
    return Array.from(this.types.values());
  }

  /**
   * Check if a type is registered.
   */
  has(name: string): boolean {
    return this.types.has(name.trim());
  }
}
