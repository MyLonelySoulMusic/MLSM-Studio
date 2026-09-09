import { useId } from "react";
import { ARTIST_LOGO_URL } from "../services/artist-brand";
import { FIGURE_CLIP, FIGURE_PRINT_MASK, LOGO_VECTORS, LOGO_VIEWBOX } from "../services/artist-logo-design";

export function ArtistLogoFallback() {
  const clip = useId();
  const printMask = useId();
  const inkFilter = useId();
  const colors = { ink: "var(--ink)", rose: "var(--accent)", paper: "var(--panel)" };
  const vector = (part: typeof LOGO_VECTORS[number]) => <path key={part.name} d={part.path} fill={colors[part.color]} stroke={part.color === "paper" ? "var(--ink)" : "none"} strokeWidth="2" strokeLinejoin="round" />;
  return <svg className="intro-sculpture__fallback" viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`} aria-hidden="true" focusable="false">
    <defs><clipPath id={clip}><path d={FIGURE_CLIP} /></clipPath><clipPath id={printMask}><path d={FIGURE_PRINT_MASK} clipRule="evenodd" /></clipPath><filter id={inkFilter} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values=".84 0 0 0 0  0 .84 0 0 0  0 0 .84 0 0  -6 6 0 1 0" /></filter></defs>
    {LOGO_VECTORS.filter((part) => part.z < 0).map(vector)}
    <g clipPath={`url(#${clip})`}><g clipPath={`url(#${printMask})`}><image href={ARTIST_LOGO_URL} width={LOGO_VIEWBOX} height={LOGO_VIEWBOX} filter={`url(#${inkFilter})`} /></g></g>
    {LOGO_VECTORS.filter((part) => part.z >= 0).map(vector)}
  </svg>;
}
