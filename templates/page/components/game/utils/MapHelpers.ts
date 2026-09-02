import * as Phaser from "phaser";
import { FRAME_WIDTH, FRAME_HEIGHT, SHEET_COLUMNS, type Direction } from "../config/animations";

export interface SeatDef {
  seatId: string;
  x: number;
  y: number;
  facing: Direction;
  index: number;
}

export interface POIDef {
  name: string;
  x: number;
  y: number;
  facing: Direction | null;
}

export function buildSpriteFrames(scene: Phaser.Scene, key: string) {
  const tex = scene.textures.get(key);
  if (!tex.source.length) return;
  const rows = Math.floor(tex.source[0].height / FRAME_HEIGHT);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < SHEET_COLUMNS; col++) {
      tex.add(
        row * SHEET_COLUMNS + col,
        0,
        col * FRAME_WIDTH,
        row * FRAME_HEIGHT,
        FRAME_WIDTH,
        FRAME_HEIGHT,
      );
    }
  }
}

export function parseSpawns(map: Phaser.Tilemaps.Tilemap) {
  const spawnsLayer = map.getObjectLayer("spawns");
  const fallback: { x: number; y: number; facing: Direction } = {
    x: map.widthInPixels / 2,
    y: map.heightInPixels / 2,
    facing: "down",
  };

  if (!spawnsLayer || spawnsLayer.objects.length === 0) {
    return { bossSpawn: fallback, workerSpawns: [] as SeatDef[] };
  }

  const getFacing = (obj: Phaser.Types.Tilemaps.TiledObject): Direction => {
    const props = obj.properties as Array<{ name: string; value: string }> | undefined;
    const fp = props?.find((p) => p.name === "facing");
    return (fp?.value as Direction) ?? "down";
  };

  let bossObj = spawnsLayer.objects.find((o) => o.name === "boss");
  if (!bossObj) {
    const sorted = [...spawnsLayer.objects].sort((a, b) => a.x! - b.x!);
    bossObj = sorted.pop();
    if (!bossObj) {
      return { bossSpawn: fallback, workerSpawns: [] as SeatDef[] };
    }
  }

  const bossSpawn = { x: bossObj.x!, y: bossObj.y!, facing: getFacing(bossObj) };

  const workerSpawns: SeatDef[] = spawnsLayer.objects
    .filter((obj) => obj !== bossObj)
    .map((obj, index) => ({
      seatId: obj.name && obj.name !== "boss" ? obj.name : `seat-${index}`,
      x: obj.x!,
      y: obj.y!,
      facing: getFacing(obj),
      index,
    }));

  return { bossSpawn, workerSpawns };
}

export function parsePOIs(map: Phaser.Tilemaps.Tilemap): POIDef[] {
  const layer = map.getObjectLayer("pois");
  if (!layer) return [];

  const pois: POIDef[] = [];
  for (const obj of layer.objects) {
    if (obj.name && typeof obj.x === "number" && typeof obj.y === "number") {
      const props = obj.properties as Array<{ name: string; value: string }> | undefined;
      const fp = props?.find((p) => p.name === "facing");
      const facing = (fp?.value as Direction) ?? null;
      pois.push({ name: obj.name, x: obj.x, y: obj.y, facing });
    }
  }
  return pois;
}

export function buildCollisionRects(
  map: Phaser.Tilemaps.Tilemap,
  collisionGroup: Phaser.Physics.Arcade.StaticGroup,
) {
  const collisionRects: { x: number; y: number; width: number; height: number }[] = [];
  const collisionLayer = map.getObjectLayer("collisions");

  if (collisionLayer) {
    for (const obj of collisionLayer.objects) {
      const ox = obj.x ?? 0;
      const oy = obj.y ?? 0;
      const ow = obj.width ?? 0;
      const oh = obj.height ?? 0;
      if (ow === 0 || oh === 0) continue;

      // 使用 Zone + StaticBody 创建碰撞体：保留物理碰撞，且完全不渲染任何纹理
      // （旧实现用 undefined 纹理创建 Sprite，会渲染出可见的 __MISSING 色块）
      const zone = map.scene.add.zone(ox + ow / 2, oy + oh / 2, ow, oh);
      zone.setVisible(false);
      map.scene.physics.add.existing(zone, true);
      const body = (zone.body as Phaser.Physics.Arcade.StaticBody | null) ?? null;
      if (body) {
        body.enable = true;
        body.setSize(ow, oh);
      }

      collisionRects.push({ x: ox, y: oy, width: ow, height: oh });
    }
  }

  // Block exterior area so workers never path outside the room
  let wallMinX = Infinity,
    wallMinY = Infinity,
    wallMaxX = 0,
    wallMaxY = 0;
  for (const r of collisionRects) {
    wallMinX = Math.min(wallMinX, r.x);
    wallMinY = Math.min(wallMinY, r.y);
    wallMaxX = Math.max(wallMaxX, r.x + r.width);
    wallMaxY = Math.max(wallMaxY, r.y + r.height);
  }
  const mapW = map.widthInPixels;
  const mapH = map.heightInPixels;
  if (wallMinX > 0) collisionRects.push({ x: 0, y: 0, width: wallMinX, height: mapH });
  if (wallMinY > 0) collisionRects.push({ x: 0, y: 0, width: mapW, height: wallMinY });
  if (wallMaxX < mapW)
    collisionRects.push({ x: wallMaxX, y: 0, width: mapW - wallMaxX, height: mapH });
  if (wallMaxY < mapH)
    collisionRects.push({ x: 0, y: wallMaxY, width: mapW, height: mapH - wallMaxY });

  return collisionRects;
}

export interface AnimatedProp {
  tilesetName: string;
  anchorLocalId: number;
  skipLocalIds: Set<number>;
  spriteKey: string;
  frameWidth: number;
  frameHeight: number;
  endFrame: number;
  frameRate: number;
}

export function renderTileObjectLayer(
  scene: Phaser.Scene,
  map: Phaser.Tilemaps.Tilemap,
  layerName: string,
  tilesets: Phaser.Tilemaps.Tileset[],
  depth: number,
  animatedProps?: AnimatedProp[],
) {
  const objectLayer = map.getObjectLayer(layerName);
  if (!objectLayer) return;

  for (const obj of objectLayer.objects) {
    if (!obj.gid) continue;

    let tileset: Phaser.Tilemaps.Tileset | null = null;
    for (let i = tilesets.length - 1; i >= 0; i--) {
      if (obj.gid >= tilesets[i].firstgid) {
        tileset = tilesets[i];
        break;
      }
    }
    if (!tileset) continue;

    const localId = obj.gid - tileset.firstgid;

    const anim = animatedProps?.find(
      (a) => a.tilesetName === tileset!.name && a.skipLocalIds.has(localId),
    );

    if (anim) {
      if (localId === anim.anchorLocalId) {
        const animKey = `${anim.spriteKey}-anim`;
        if (!scene.anims.exists(animKey)) {
          scene.anims.create({
            key: animKey,
            frames: scene.anims.generateFrameNumbers(anim.spriteKey, {
              start: 0,
              end: anim.endFrame,
            }),
            frameRate: anim.frameRate,
            repeat: -1,
          });
        }
        const tileH = tileset.tileHeight;
        scene.add
          .sprite(obj.x!, obj.y! - anim.frameHeight + tileH, anim.spriteKey)
          .setOrigin(0, 0)
          .setDepth(depth)
          .play(animKey);
      }
      continue;
    }

    const tileW = tileset.tileWidth;
    const tileH = tileset.tileHeight;
    const srcX = (localId % tileset.columns) * tileW;
    const srcY = Math.floor(localId / tileset.columns) * tileH;

    const frameKey = `${tileset.name}_${localId}`;
    if (!scene.textures.exists(frameKey)) {
      const baseTexture = scene.textures.get(tileset.name);
      baseTexture.add(localId, 0, srcX, srcY, tileW, tileH);
    }

    scene.add
      .image(obj.x!, obj.y! - tileH, tileset.name, localId)
      .setOrigin(0, 0)
      .setDepth(depth);
  }
}
