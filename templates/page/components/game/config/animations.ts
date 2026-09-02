/**
 * Character spritesheet animation configuration.
 *
 * All Premade_Character_48x48_XX.png sheets share the same layout:
 *   48×96 frames, 56 cols × ~20 rows
 *     Row 0: preview/idle thumbnails
 *     Row 1: idle — right(6) · up(6) · left(6) · down(6)
 *     Row 2: walk — right(6) · up(6) · left(6) · down(6)
 */

export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 96;
export const SHEET_COLUMNS = 56;

const FRAMES_PER_DIR = 6;

/** Pixel/sec movement speed */
export const MOVE_SPEED = 160;

export interface AnimDef {
  key: string;
  start: number;
  end: number;
  frameRate: number;
  repeat: number;
}

// Boss character (player-controlled) — male character
export const BOSS_SPRITE_KEY = "character_09";
export const BOSS_SPRITE_PATH = "/characters/Premade_Character_48x48_09.png";

// Keep legacy exports for Player.ts compatibility
export const SPRITE_KEY = BOSS_SPRITE_KEY;
export const SPRITE_PATH = BOSS_SPRITE_PATH;

export interface WorkerSpriteConfig {
  key: string;
  path: string;
  label: string;
}

export const WORKER_SPRITES: WorkerSpriteConfig[] = [
  { key: "character_02", path: "/characters/Premade_Character_48x48_02.png", label: "Alice" },
  { key: "character_03", path: "/characters/Premade_Character_48x48_03.png", label: "Bob" },
  { key: "character_04", path: "/characters/Premade_Character_48x48_04.png", label: "Carol" },
  { key: "character_05", path: "/characters/Premade_Character_48x48_05.png", label: "Dave" },
];

const directions = ["right", "up", "left", "down"] as const;
export type Direction = (typeof directions)[number];

export function makeAnims(
  spriteKey: string,
  prefix: string,
  row: number,
  frameRate: number,
): AnimDef[] {
  return directions.map((dir, i) => ({
    key: `${spriteKey}:${prefix}-${dir}`,
    start: row * SHEET_COLUMNS + i * FRAMES_PER_DIR,
    end: row * SHEET_COLUMNS + i * FRAMES_PER_DIR + FRAMES_PER_DIR - 1,
    frameRate,
    repeat: -1,
  }));
}

// Boss anims (legacy format without spriteKey prefix for backward compat)
function rowAnims(prefix: string, row: number, frameRate: number): AnimDef[] {
  return directions.map((dir, i) => ({
    key: `${prefix}-${dir}`,
    start: row * SHEET_COLUMNS + i * FRAMES_PER_DIR,
    end: row * SHEET_COLUMNS + i * FRAMES_PER_DIR + FRAMES_PER_DIR - 1,
    frameRate,
    repeat: -1,
  }));
}

export const IDLE_ANIMS = rowAnims("idle", 1, 8);
export const WALK_ANIMS = rowAnims("walk", 2, 10);
export const ALL_ANIMS: AnimDef[] = [...IDLE_ANIMS, ...WALK_ANIMS];
