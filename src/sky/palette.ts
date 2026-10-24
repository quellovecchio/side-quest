import { Color3 } from "@babylonjs/core";

// I colori del cielo (TimeOfDay.ts) vengono dai token del design system di footie-stars, da cui il
// cielo è stato portato: qui ne resta solo la tabella dei valori, senza il CSS.
const TOKENS: Record<string, string> = {
  "--stmp-bone-50": "#FCF7EC", "--stmp-bone-100": "#F8F0DD", "--stmp-bone-200": "#F0E3C6", "--stmp-bone-300": "#E4D0A6",
  "--stmp-sky-100": "#D6E9F7", "--stmp-sky-300": "#7AB7E6", "--stmp-sky-400": "#3F90CC", "--stmp-sky-500": "#2571AB", "--stmp-sky-600": "#1A5588",
  "--stmp-gold-100": "#FDEFC8", "--stmp-gold-300": "#FAD37C",
  "--stmp-sunset-100": "#FBE0D2", "--stmp-sunset-300": "#F4A37D", "--stmp-sunset-400": "#EC6D3E", "--stmp-sunset-500": "#E04A1E",
  "--stmp-grape-400": "#8A53B0", "--stmp-grape-500": "#6E3A95",
};

export function tokenColor(name: string): Color3 {
  return Color3.FromHexString(TOKENS[name] ?? "#FF00FF");
}
