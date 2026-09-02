/**
 * Emote bubble spritesheet configuration.
 *
 * Source: UI_thinking_emotes_animation_48x48.png (480×480, 10×10 grid of 48×48 frames)
 *
 * Frame layout (row * 10 + col):
 *   Row 0-3: Bubble open/close animation sequences
 *   Row 4: yellow !, $, sword, empty bubble, treasure chest
 *   Row 5: red !, ?, heart, Z (sleep), device
 *   Row 6: gold, -, gray ?, star, music note, frame
 *   Row 7: cat/angry, red sword, wrench, music
 *   Row 8: person, medal, moon, sun/coin
 *   Row 9: ban, dots "...", striped, water drop
 *
 * Each icon occupies 2 consecutive frames (normal + alt for animation).
 */

export const EMOTE_SHEET_KEY = "emotes";
export const EMOTE_SHEET_PATH = "/sprites/emotes_48x48.png";
export const EMOTE_FRAME_SIZE = 48;

export interface EmoteDef {
  key: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

export const EMOTE_ANIMS: EmoteDef[] = [
  // ── Status indicators ─────────────────────────────
  { key: "emote:sleep", frames: [56, 57], frameRate: 2, repeat: -1 },
  { key: "emote:thinking", frames: [52, 53], frameRate: 2, repeat: -1 },
  { key: "emote:alert", frames: [40, 41], frameRate: 4, repeat: 3 },
  { key: "emote:fail", frames: [50, 51], frameRate: 4, repeat: 3 },
  { key: "emote:heart", frames: [54, 55], frameRate: 2, repeat: 3 },

  // ── Mood / activity ───────────────────────────────
  { key: "emote:star", frames: [64, 65], frameRate: 3, repeat: 3 },
  { key: "emote:music", frames: [66, 67], frameRate: 3, repeat: -1 },
  { key: "emote:confused", frames: [62, 63], frameRate: 2, repeat: -1 },
  { key: "emote:angry", frames: [70, 71], frameRate: 3, repeat: 3 },
  { key: "emote:wrench", frames: [74, 75], frameRate: 2, repeat: -1 },
  { key: "emote:device", frames: [58, 59], frameRate: 2, repeat: -1 },
  { key: "emote:dots", frames: [92, 93], frameRate: 2, repeat: -1 },
];
