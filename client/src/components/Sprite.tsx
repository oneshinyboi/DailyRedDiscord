import { useState } from "react";
import { spriteUrl } from "../lib/sprites";

interface SpriteProps {
  species: string;
  back?: boolean;
  className?: string;
  alt?: string;
}

/** Gen 3 FireRed/LeafGreen sprite, self-hosted in /public/sprites. */
export default function Sprite({
  species,
  back = false,
  className = "",
  alt,
}: SpriteProps) {
  const [failed, setFailed] = useState(false);
  const url = spriteUrl(species, back);
  if (url === null || failed) {
    return (
      <span className={`sprite sprite-missing ${className}`} aria-label={alt}>
        ?
      </span>
    );
  }
  return (
    <img
      className={`sprite ${className}`}
      src={url}
      alt={alt ?? species}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
