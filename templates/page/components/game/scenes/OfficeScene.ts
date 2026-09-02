import * as Phaser from "phaser";
import { resetWanderClock } from "../entities/Worker";
import { WORKER_SPRITES } from "../config/animations";
import { EMOTE_SHEET_KEY, EMOTE_SHEET_PATH, EMOTE_FRAME_SIZE } from "../config/emotes";
import { Pathfinder } from "../utils/Pathfinder";
import {
  buildSpriteFrames,
  parseSpawns,
  parsePOIs,
  buildCollisionRects,
  renderTileObjectLayer,
  type AnimatedProp,
  type SeatDef,
} from "../utils/MapHelpers";
import { gameEvents } from "@/lib/events";
import { createLogger } from "@/lib/logger";
import { PF_PADDING } from "@/lib/constants";

import { CameraController } from "../systems/CameraController";
import { WorkerManager } from "../systems/WorkerManager";
import { InteractionManager } from "../systems/InteractionManager";
import { DoorManager } from "../systems/DoorManager";
import { initSceneEventBridge } from "../systems/SceneEventBridge";
import { OFFICE_CONFIG } from "@/lib/office-config";
import { withBase } from "@/lib/base-path";

const log = createLogger("OfficeScene");

export class OfficeScene extends Phaser.Scene {
  private workerManager!: WorkerManager;
  private interactionManager!: InteractionManager;
  private doorManager!: DoorManager;
  private cameraController!: CameraController;
  private terminalOpen = false;
  private cleanupEventBridge: (() => void) | null = null;

  constructor() {
    super({ key: "OfficeScene" });
  }

  preload() {
    // 加载进度反馈：大场景资源多（瓦片/角色），加载可能需数秒，给用户明确提示
    this.load.on("progress", (value: number) => {
      const pct = Math.round(value * 100);
      const el = document.querySelector("[data-office-loading]");
      if (el) el.textContent = `正在加载办公室场景 ${pct}%…`;
    });
    this.load.on("complete", () => {
      const el = document.querySelector("[data-office-loading]");
      if (el) el.remove();
    });
    this.load.tilemapTiledJSON("office", withBase("/maps/office2.json"));

    this.load.once("filecomplete-tilemapJSON-office", () => {
      const cached = this.cache.tilemap.get("office");
      if (!cached?.data?.tilesets) return;
      for (const ts of cached.data.tilesets) {
        const imagePath = (ts.image as string) || "";
        const basename = imagePath.split(/[\\/]/).pop()!;
        this.load.image(ts.name, withBase(`/tilesets/${basename}`));
      }
    });

    // 负责人使用配置指定成员的外观；其余成员外观来自 WORKER_SPRITES
    for (const ws of WORKER_SPRITES) {
      this.load.image(ws.key, withBase(ws.path));
    }
    this.load.image("character_01", withBase("/characters/Premade_Character_48x48_01.png"));
    this.load.image("character_06", withBase("/characters/Premade_Character_48x48_06.png"));
    this.load.image("character_09", withBase("/characters/Premade_Character_48x48_09.png"));

    this.load.spritesheet(EMOTE_SHEET_KEY, withBase(EMOTE_SHEET_PATH), {
      frameWidth: EMOTE_FRAME_SIZE,
      frameHeight: EMOTE_FRAME_SIZE,
    });

    this.load.spritesheet("anim-cauldron", withBase("/sprites/animated_witch_cauldron_48x48.png"), {
      frameWidth: 96,
      frameHeight: 96,
    });

    this.load.spritesheet("anim-door", withBase("/sprites/animated_door_big_4_48x48.png"), {
      frameWidth: 48,
      frameHeight: 144,
    });
  }

  create() {
    for (const ws of WORKER_SPRITES) {
      buildSpriteFrames(this, ws.key);
    }
    buildSpriteFrames(this, "character_01");
    buildSpriteFrames(this, "character_06");
    buildSpriteFrames(this, "character_09");

    const map = this.make.tilemap({ key: "office" });

    const allTilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of map.tilesets) {
      const added = map.addTilesetImage(ts.name, ts.name);
      if (added) allTilesets.push(added);
    }
    if (allTilesets.length === 0) {
      log.error("No tilesets loaded");
      return;
    }

    map.createLayer("floor", allTilesets);
    map.createLayer("walls", allTilesets);
    map.createLayer("ground", allTilesets);
    map.createLayer("furniture", allTilesets);
    map.createLayer("objects", allTilesets);

    const animatedProps: AnimatedProp[] = [
      {
        tilesetName: "11_Halloween_48x48",
        anchorLocalId: 130,
        skipLocalIds: new Set([130, 131, 146, 147]),
        spriteKey: "anim-cauldron",
        frameWidth: 96,
        frameHeight: 96,
        endFrame: 11,
        frameRate: 8,
      },
    ];
    renderTileObjectLayer(this, map, "props", allTilesets, 5, animatedProps);
    renderTileObjectLayer(this, map, "props-over", allTilesets, 11);

    const overheadLayer = map.createLayer("overhead", allTilesets);
    if (overheadLayer) overheadLayer.setDepth(10);

    const collisionGroup = this.physics.add.staticGroup();
    const collisionRects = buildCollisionRects(map, collisionGroup);

    const pathfinder = new Pathfinder(
      map.widthInPixels,
      map.heightInPixels,
      collisionRects,
      PF_PADDING,
    );

    const { bossSpawn, workerSpawns } = parseSpawns(map);
    const pois = parsePOIs(map);

    // 负责人（表格维护人）坐老板位（地图里侧的大工位），其余成员坐普通工位
    const allWorkerSpawns: SeatDef[] = [
      {
        seatId: "boss",
        x: bossSpawn.x,
        y: bossSpawn.y,
        facing: bossSpawn.facing,
        index: -1,
      },
      ...workerSpawns,
    ];

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // ── Systems ───────────────────────────────────────────
    this.cameraController = new CameraController(
      this,
      map.widthInPixels,
      map.heightInPixels,
    );
    this.cameraController.init();

    this.workerManager = new WorkerManager(this, allWorkerSpawns, pois, pathfinder);

    this.interactionManager = new InteractionManager(this, this.workerManager);
    this.interactionManager.initInteractionUI();

    this.doorManager = new DoorManager(this, () => this.workerManager.workers);
    this.doorManager.initDoors();

    resetWanderClock();

    this.cleanupEventBridge = initSceneEventBridge(
      this.workerManager,
      this.interactionManager,
      (open) => {
        this.terminalOpen = open;
      },
    );

    gameEvents.emit("seats-discovered", allWorkerSpawns);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  // ── Cleanup ────────────────────────────────────────────

  private cleanup() {
    this.cleanupEventBridge?.();
    this.cleanupEventBridge = null;

    this.workerManager?.destroyAll();
    this.interactionManager?.destroy();
    this.doorManager?.destroy?.();
  }

  // ── Update ─────────────────────────────────────────────

  update() {
    if (this.interactionManager.interactionMenu.visible) {
      this.interactionManager.interactionMenu.update();
      this.workerManager.updateAll();
      return;
    }

    if (this.terminalOpen) {
      this.workerManager.updateAll();
      this.doorManager.updateDoors();
      return;
    }

    this.workerManager.updateAll();
    this.doorManager.updateDoors();

    // 负责人标识：常驻 E（在 InteractionManager 中绘制，跟随负责人 Worker）
    this.interactionManager.updateOwnerIndicator(this.workerManager);
  }
}
