export interface FilterConfig { includeAll: boolean; defaultValue: string | null }

export function uniqueFilterValues(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, 500);
}

export function filterOptions(values: readonly string[], config: Pick<FilterConfig, "includeAll">): Array<string | null> {
  const unique = uniqueFilterValues(values);
  return config.includeAll ? [null, ...unique] : unique;
}

export function resolveFilterDefault(values: readonly string[], config: FilterConfig): string | null {
  const options = filterOptions(values, config);
  if (options.includes(config.defaultValue)) return config.defaultValue;
  return config.includeAll ? null : options[0] ?? null;
}

export function resetFilterValue(values: readonly string[], config: FilterConfig, activeValue: string | null): string | null {
  void activeValue;
  return resolveFilterDefault(values, config);
}

export function encodeFilterOption(value: string | null): string {
  return JSON.stringify(value);
}

export function decodeFilterOption(value: string): string | null {
  const decoded: unknown = JSON.parse(value);
  if (decoded === null || typeof decoded === "string") return decoded;
  throw new Error("Valore filtro non valido.");
}
