/**
 * A dashboard filter with optional widget targeting.
 *
 * Legacy filters without `targetMode` remain global. New filters distinguish
 * explicitly between all widgets and a selected set.
 */
export type DashboardFilterLike = {
  id: string;
  datasetId: string;
  fieldId: string;
  value: string | null;
  targetMode?: "all" | "selected";
  widgetIds?: string[];
};

/**
 * Return the filters that should affect one widget.
 *
 * Filters always stay scoped to their dataset. A global or legacy filter
 * applies to every widget in that dataset; a selected filter applies only
 * when the widget id is explicitly listed (an empty list targets none).
 */
export function filtersForWidget<T extends DashboardFilterLike>(
  filters: readonly T[],
  widgetId: string,
  datasetId: string,
): T[] {
  return filters.filter((filter) => {
    if (filter.datasetId !== datasetId) return false;
    if (filter.targetMode !== "selected") return true;
    return filter.widgetIds?.includes(widgetId) ?? false;
  });
}

/**
 * Sanitize widget targets coming from persisted or imported dashboard JSON.
 * Only non-empty strings that point to an existing widget are retained, in
 * their original order and without duplicates.
 */
export function normalizeFilterTargets(widgetIds: unknown, validWidgetIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(widgetIds)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const widgetId of widgetIds) {
    if (typeof widgetId !== "string" || widgetId.length === 0) continue;
    if (!validWidgetIds.has(widgetId) || seen.has(widgetId)) continue;
    seen.add(widgetId);
    normalized.push(widgetId);
  }
  return normalized;
}
