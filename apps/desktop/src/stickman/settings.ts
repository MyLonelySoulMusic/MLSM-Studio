export const defaultBivioColors = {
  paper: "#ffffff",
  road: "#ffffff",
  roadEdges: "#211b1f",
  crowd: "#ff4f9a",
  solo: "#ff4f9a",
  leftText: "#211b1f",
  rightText: "#ff4f9a",
  rightCaption: "#211b1f",
  underlines: "#ff4f9a",
  signpost: "#211b1f",
  leftArrow: "#211b1f",
  rightArrow: "#ff4f9a",
  cross: "#ff4f9a",
  arrowHeart: "#ffffff",
  heart: "#ff4f9a",
  ink: "#211b1f",
  accentInk: "#ff4f9a",
  shadows: "#211b1f",
};
export type BivioColors = typeof defaultBivioColors;
export type BivioColorKey = keyof BivioColors;

export interface BivioSettings {
  leftText: string;
  rightText: string;
  rightCaption: string;
  crowdCount: number;
  pace: number;
  grain: number;
  colors: BivioColors;
}

export const defaultBivioSettings: BivioSettings = {
  leftText: "AUTOTUNE\nVOICE OVER\nPRODUCTION\nSAMPLES\nSAME 4 CHORDS\nPITCH CORRECTION\nMIDI INSTRUMENTS\nAI MASTER\nHIDDEN AI\nINSTRUMENTS",
  rightText: "AI\nPRODUCERS\nWHO PUT\nTHEIR SOUL\nINTO IT",
  rightCaption: "EVEN WITH\nDAW WORK",
  crowdCount: 36,
  pace: 1,
  grain: .55,
  colors: { ...defaultBivioColors },
};

export const stickmanAnimations = [{ id: "bivio", label: "Bivio" }] as const;

export function normalizeBivioSettings(value: Omit<Partial<BivioSettings>, "colors"> & { colors?: Partial<BivioColors> | null }): BivioSettings {
  const text = (key: "leftText" | "rightText" | "rightCaption", max: number) => typeof value[key] === "string" ? value[key].slice(0, max) : defaultBivioSettings[key];
  const number = (key: "crowdCount" | "pace" | "grain", min: number, max: number) => typeof value[key] === "number" && Number.isFinite(value[key]) ? Math.max(min, Math.min(max, value[key])) : defaultBivioSettings[key];
  const colors = { ...defaultBivioColors };
  for (const key of Object.keys(colors) as BivioColorKey[]) {
    const color = value.colors?.[key];
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) colors[key] = color.toLowerCase();
  }
  return { leftText: text("leftText", 600), rightText: text("rightText", 300), rightCaption: text("rightCaption", 120), crowdCount: Math.round(number("crowdCount", 12, 60)), pace: number("pace", .5, 1.5), grain: number("grain", 0, 1), colors };
}
