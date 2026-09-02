"use client";

import { WORKER_SPRITES } from "@/components/game/config/animations";
import CharacterPortrait from "../CharacterPortrait";

interface SpritePreviewProps {
  selectedSpriteKey: string;
  busy: boolean;
  onSelectSprite: (spriteKey: string, spritePath: string, spriteLabel: string) => void;
}

export default function SpritePreview({
  selectedSpriteKey,
  busy,
  onSelectSprite,
}: SpritePreviewProps) {
  return (
    <div className="seat-manager__sprite-grid">
      {WORKER_SPRITES.map((sprite) => {
        const active = sprite.key === selectedSpriteKey;
        return (
          <button
            key={sprite.key}
            type="button"
            className={`seat-card ${active ? "seat-card--active" : ""}`}
            onClick={() => onSelectSprite(sprite.key, sprite.path, sprite.label)}
            disabled={busy}
            style={{ opacity: busy ? 0.65 : 1, cursor: busy ? "not-allowed" : "pointer" }}
          >
            <div className="seat-manager__sprite-preview">
              <CharacterPortrait spritePath={sprite.path} name={sprite.label} />
            </div>
            <div style={{ fontSize: 9, marginTop: 8 }}>{sprite.label}</div>
            <div style={{ fontSize: 7, color: "var(--pixel-muted)", marginTop: 2 }}>
              {sprite.key}
            </div>
          </button>
        );
      })}
    </div>
  );
}
