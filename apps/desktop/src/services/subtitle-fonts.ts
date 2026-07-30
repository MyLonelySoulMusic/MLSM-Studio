export const subtitleFontOptions = [
  { value: "Orbitron", label: "Orbitron · digitale", weight: 800 },
  { value: "Montserrat", label: "Montserrat · moderno", weight: 800 },
  { value: "Bebas Neue", label: "Bebas Neue · editoriale", weight: 400 },
  { value: "Oswald", label: "Oswald · condensato", weight: 700 },
  { value: "Playfair Display", label: "Playfair Display · cinematografico", weight: 800 },
  { value: "Space Grotesk", label: "Space Grotesk · contemporaneo", weight: 700 }
] as const;

export function subtitleFontWeight(fontFamily: string): number {
  return subtitleFontOptions.find((font) => font.value === fontFamily)?.weight ?? 800;
}
