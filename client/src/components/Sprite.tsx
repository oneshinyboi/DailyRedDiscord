import { useState } from "react";
import { dexNumOf } from "../lib/dex";

interface SpriteProps {
  species: string;
  back?: boolean;
  className?: string;
  alt?: string;
}

// Discord's proxy caches image URLs for 4 hours, so bump this whenever the
// files in /public/sprites change.
const SPRITE_VERSION = 2;

/** Gen 3 FireRed/LeafGreen sprite, self-hosted in /public/sprites. */
export default function Sprite({
  species,
  back = false,
  className = "",
  alt,
}: SpriteProps) {
  const [failed, setFailed] = useState(false);
  const num = dexNumOf(species);
  if (num === null || failed) {
    return (
      <span className={`sprite sprite-missing ${className}`} aria-label={alt}>
        ?
      </span>
    );
  }
  return (
    <img
      className={`sprite ${className}`}
      src={`/sprites/${back ? "back" : "front"}/${num}.png?v=${SPRITE_VERSION}`}
      alt={alt ?? species}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
