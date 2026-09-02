"use client";

import type { BgmState } from "@/lib/useBgm";

export default function MusicControls({ bgm }: { bgm: BgmState }) {
  const volumePercent = Math.round(bgm.volume * 100);

  return (
    <div className="hud-music-bar">
      <span className="hud-music-bar__label">♪</span>
      <input
        className="hud-music-bar__slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={volumePercent}
        onChange={(e) => bgm.setVolume(Number(e.target.value))}
      />
      <span className="hud-music-bar__pct">{volumePercent}</span>
    </div>
  );
}
