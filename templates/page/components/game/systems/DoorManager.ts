import * as Phaser from "phaser";
import type { Worker } from "../entities/Worker";

interface DoorEntry {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  open: boolean;
}

export class DoorManager {
  private scene: Phaser.Scene;
  private doors: DoorEntry[] = [];
  private getWorkers: () => Worker[];

  constructor(scene: Phaser.Scene, getWorkers: () => Worker[]) {
    this.scene = scene;
    this.getWorkers = getWorkers;
  }

  initDoors() {
    const doorPositions = [
      { x: 528, y: 528 },
      { x: 960, y: 528 },
    ];

    if (!this.scene.anims.exists("door-open")) {
      this.scene.anims.create({
        key: "door-open",
        frames: this.scene.anims.generateFrameNumbers("anim-door", { start: 0, end: 4 }),
        frameRate: 10,
        repeat: 0,
      });
      this.scene.anims.create({
        key: "door-close",
        frames: this.scene.anims.generateFrameNumbers("anim-door", { start: 4, end: 0 }),
        frameRate: 10,
        repeat: 0,
      });
    }

    for (const pos of doorPositions) {
      const sprite = this.scene.add
        .sprite(pos.x, pos.y, "anim-door", 0)
        .setOrigin(0, 0)
        .setDepth(4);
      this.doors.push({ sprite, x: pos.x + 24, y: pos.y + 48, open: false });
    }
  }

  updateDoors() {
    const threshold = 60;
    const workers = this.getWorkers();
    for (const door of this.doors) {
      let near = false;
      for (const w of workers) {
        const wx = w.sprite.x - door.x;
        const wy = w.sprite.y - door.y;
        if (wx * wx + wy * wy < threshold * threshold) {
          near = true;
          break;
        }
      }
      if (near && !door.open) {
        door.open = true;
        door.sprite.play("door-open");
      } else if (!near && door.open) {
        door.open = false;
        door.sprite.play("door-close");
      }
    }
  }

  destroy() {
    for (const door of this.doors) {
      door.sprite.destroy();
    }
    this.doors = [];
  }
}
