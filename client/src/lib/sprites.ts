import { dexNumOf } from "./dex";

// Discord's proxy caches image URLs for 4 hours, so bump this whenever the
// files in /public/sprites change.
const SPRITE_VERSION = 2;

export function spriteUrl(species: string, back = false): string | null {
  const num = dexNumOf(species);
  if (num === null) return null;
  return `/sprites/${back ? "back" : "front"}/${num}.png?v=${SPRITE_VERSION}`;
}
