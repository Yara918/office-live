import * as Phaser from "phaser";
import { SPRITE_KEY, MOVE_SPEED, ALL_ANIMS, FRAME_WIDTH, FRAME_HEIGHT } from "../config/animations";

type Direction = "down" | "up" | "left" | "right";

export class Player {
  sprite: Phaser.Physics.Arcade.Sprite;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd: Record<string, Phaser.Input.Keyboard.Key>;
  private facing: Direction;
  private arrow: Phaser.GameObjects.Sprite | null = null;
  private hasMovedOnce = false;

  constructor(scene: Phaser.Scene, x: number, y: number, facing: Direction = "left") {
    this.facing = facing;
    this.createAnimations(scene);

    this.sprite = scene.physics.add.sprite(x, y, SPRITE_KEY, 0);
    this.sprite.setDepth(5);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(FRAME_WIDTH * 0.5, FRAME_HEIGHT * 0.2);
    body.setOffset(FRAME_WIDTH * 0.25, FRAME_HEIGHT * 0.75);

    this.initArrow(scene, x, y);

    const kb = scene.input.keyboard;
    if (!kb) throw new Error("Keyboard plugin not available");
    this.cursors = kb.createCursorKeys();
    kb.clearCaptures();
    this.wasd = kb.addKeys(
      {
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
      },
      false,
    ) as Record<string, Phaser.Input.Keyboard.Key>;

    this.sprite.anims.play(`idle-${this.facing}`);
  }

  private initArrow(scene: Phaser.Scene, x: number, y: number) {
    if (!scene.textures.exists("boss-arrow")) return;

    if (!scene.anims.exists("boss-arrow-bounce")) {
      scene.anims.create({
        key: "boss-arrow-bounce",
        frames: scene.anims.generateFrameNumbers("boss-arrow", { start: 0, end: 5 }),
        frameRate: 6,
        repeat: -1,
      });
    }

    const headY = y - FRAME_HEIGHT * 0.5;
    this.arrow = scene.add.sprite(x, headY, "boss-arrow", 0);
    this.arrow.setDepth(25);
    this.arrow.setTint(0xffd700);
    this.arrow.play("boss-arrow-bounce");
  }

  private createAnimations(scene: Phaser.Scene) {
    if (scene.anims.exists("idle-down")) return;

    for (const anim of ALL_ANIMS) {
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = anim.start; i <= anim.end; i++) {
        frames.push({ key: SPRITE_KEY, frame: i });
      }
      scene.anims.create({
        key: anim.key,
        frames,
        frameRate: anim.frameRate,
        repeat: anim.repeat,
      });
    }
  }

  isMoving(): boolean {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    return body.velocity.x !== 0 || body.velocity.y !== 0;
  }

  update() {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const speed = MOVE_SPEED;

    // Determine velocity from input
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -speed;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = speed;

    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -speed;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = speed;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const factor = Math.SQRT1_2;
      vx *= factor;
      vy *= factor;
    }

    body.setVelocity(vx, vy);

    const moving = vx !== 0 || vy !== 0;

    if (!this.hasMovedOnce && moving && this.arrow) {
      this.hasMovedOnce = true;
      this.arrow.destroy();
      this.arrow = null;
    }

    if (this.arrow) {
      this.arrow.setPosition(this.sprite.x, this.sprite.y - FRAME_HEIGHT * 0.5);
    }

    if (moving) {
      // Prefer horizontal when diagonal
      if (vx < 0) this.facing = "left";
      else if (vx > 0) this.facing = "right";
      else if (vy < 0) this.facing = "up";
      else if (vy > 0) this.facing = "down";

      const walkKey = `walk-${this.facing}`;
      if (this.sprite.anims.currentAnim?.key !== walkKey) {
        this.sprite.anims.play(walkKey);
      }
    } else {
      const idleKey = `idle-${this.facing}`;
      if (this.sprite.anims.currentAnim?.key !== idleKey) {
        this.sprite.anims.play(idleKey);
      }
    }
  }
}
