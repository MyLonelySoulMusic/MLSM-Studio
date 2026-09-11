const REPORT_VIEW_PREFIX = "#/reports/view/";

export function reportViewIdFromHash(hash: string): string | null {
  if (!hash.startsWith(REPORT_VIEW_PREFIX)) return null;
  const encoded = hash.slice(REPORT_VIEW_PREFIX.length).split(/[?#]/, 1)[0];
  if (!encoded) return null;
  try {
    const id = decodeURIComponent(encoded);
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function createDashboardViewUrl(dashboardId: string, location: Pick<Location, "origin" | "pathname" | "search"> = window.location): string {
  if (!/^[A-Za-z0-9_-]+$/.test(dashboardId)) throw new Error("ID dashboard non valido.");
  return `${location.origin}${location.pathname}${location.search}${REPORT_VIEW_PREFIX}${encodeURIComponent(dashboardId)}`;
}
