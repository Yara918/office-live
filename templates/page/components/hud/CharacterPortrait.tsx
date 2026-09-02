"use client";

import { FRAME_WIDTH, FRAME_HEIGHT, SHEET_COLUMNS } from "@/components/game/config/animations";
import { withBase } from "@/lib/base-path";

const PORTRAIT_FRAME_INDEX = SHEET_COLUMNS + 18;

export default function CharacterPortrait({
  spritePath,
  name,
  large = false,
}: {
  spritePath?: string;
  name: string;
  large?: boolean;
}) {
  const scale = large ? 2.4 : 1.1;
  const width = FRAME_WIDTH * scale;
  const height = FRAME_HEIGHT * scale;
  const frameX = (PORTRAIT_FRAME_INDEX % SHEET_COLUMNS) * FRAME_WIDTH;
  const frameY = Math.floor(PORTRAIT_FRAME_INDEX / SHEET_COLUMNS) * FRAME_HEIGHT;

  if (!spritePath) {
    return <span style={{ fontSize: 8, color: "var(--pixel-muted)" }}>EMPTY</span>;
  }

  return (
    <div
      aria-label={name}
      style={{
        width,
        height,
        backgroundImage: `url(${withBase(spritePath)})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: `-${frameX * scale}px -${frameY * scale}px`,
        backgroundSize: `${SHEET_COLUMNS * FRAME_WIDTH * scale}px auto`,
        imageRendering: "pixelated",
        flexShrink: 0,
      }}
    />
  );
}
