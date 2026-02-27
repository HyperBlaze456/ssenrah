import { invoke } from "./invoke";
import type { ConfigScope, Settings, ValidationError, ValidationWarning } from "@/types";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface PermissionRuleResult {
  valid: boolean;
  tool: string;
  specifier: string | null;
  error: string | null;
}

export interface HookMatcherResult {
  valid: boolean;
  error: string | null;
}

export async function validateSettings(settings: Settings, scope: ConfigScope): Promise<ValidationResult> {
  return invoke<ValidationResult>("validate_settings", { settings, scope });
}

export async function validatePermissionRule(rule: string): Promise<PermissionRuleResult> {
  return invoke<PermissionRuleResult>("validate_permission_rule", { rule });
}

export async function validateHookMatcher(pattern: string): Promise<HookMatcherResult> {
  return invoke<HookMatcherResult>("validate_hook_matcher", { pattern });
}
