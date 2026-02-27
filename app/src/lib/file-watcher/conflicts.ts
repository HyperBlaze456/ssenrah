export interface FieldConflict {
  field: string;
  externalValue: unknown;
  localValue: unknown;
}

export function detectConflicts(
  dirtyFields: Set<string>,
  externalData: Record<string, unknown>,
  localData: Record<string, unknown>,
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];

  for (const field of dirtyFields) {
    const externalValue = getNestedValue(externalData, field);
    const localValue = getNestedValue(localData, field);

    if (JSON.stringify(externalValue) !== JSON.stringify(localValue)) {
      conflicts.push({ field, externalValue, localValue });
    }
  }

  return conflicts;
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    )
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
