import * as Phaser from "phaser";

export interface MenuOption {
  label: string;
  enabled: boolean;
  action: () => void;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 30;
const FONT_SIZE = "14px";
const PAD_X = 10;
const PAD_Y = 6;
const BG_COLOR = 0x252219;
const BG_ALPHA = 0.96;
const BORDER_COLOR = 0x4a4238;
const HIGHLIGHT_FILL = 0x4a4238;
const HIGHLIGHT_ALPHA = 0.9;
const HIGHLIGHT_BORDER = 0xc9a227;
const TEXT_COLOR = "#e8e2d8";
const TEXT_HIGHLIGHT = "#f5e6b3";
const DISABLED_COLOR = "#a09888";
const DEPTH = 30;

export class InteractionMenu {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private items: Phaser.GameObjects.Text[] = [];
  private highlights: Phaser.GameObjects.Graphics[] = [];
  private hitZones: Phaser.GameObjects.Rectangle[] = [];
  private scene: Phaser.Scene;
  private options: MenuOption[] = [];
  private selectedIndex = 0;
  private _visible = false;
  private openFrame = 0;

  private upKey: Phaser.Input.Keyboard.Key;
  private downKey: Phaser.Input.Keyboard.Key;
  private upArrow: Phaser.Input.Keyboard.Key;
  private downArrow: Phaser.Input.Keyboard.Key;
  private confirmKey: Phaser.Input.Keyboard.Key;
  private enterKey: Phaser.Input.Keyboard.Key;
  private escKey: Phaser.Input.Keyboard.Key;

  onClose: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.bg = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.bg]);
    this.container.setDepth(DEPTH);
    this.container.setVisible(false);
    this.container.setScrollFactor(0);

    const kb = scene.input.keyboard;
    if (!kb) throw new Error("Keyboard plugin not available");
    this.upKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W, false);
    this.downKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S, false);
    this.upArrow = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false);
    this.downArrow = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false);
    this.confirmKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
    this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER, false);
    this.escKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC, false);
  }

  get visible(): boolean {
    return this._visible;
  }

  show(worldX: number, worldY: number, options: MenuOption[]) {
    this.options = options;
    this.selectedIndex = options.findIndex((o) => o.enabled);
    if (this.selectedIndex < 0) this.selectedIndex = 0;
    this.openFrame = this.scene.game.getFrame();

    this.clearItems();

    const totalH = options.length * ITEM_HEIGHT + PAD_Y * 2;

    this.bg.clear();
    this.bg.fillStyle(BG_COLOR, BG_ALPHA);
    this.bg.fillRoundedRect(0, 0, MENU_WIDTH, totalH, 6);
    this.bg.lineStyle(2, BORDER_COLOR, 1);
    this.bg.strokeRoundedRect(0, 0, MENU_WIDTH, totalH, 6);

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const y = PAD_Y + i * ITEM_HEIGHT;

      const highlight = this.scene.add.graphics();
      highlight.setPosition(MENU_WIDTH / 2, y + ITEM_HEIGHT / 2);
      const w = MENU_WIDTH - 4;
      const h = ITEM_HEIGHT - 2;
      highlight.fillStyle(HIGHLIGHT_FILL, HIGHLIGHT_ALPHA);
      highlight.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
      highlight.lineStyle(2, HIGHLIGHT_BORDER, 0.95);
      highlight.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
      highlight.setVisible(false);
      this.highlights.push(highlight);
      this.container.add(highlight);

      const txt = this.scene.add.text(PAD_X, y + ITEM_HEIGHT / 2, opt.label, {
        fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: FONT_SIZE,
        color: opt.enabled ? TEXT_COLOR : DISABLED_COLOR,
      });
      txt.setResolution(window.devicePixelRatio * 2);
      txt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      txt.setOrigin(0, 0.5);
      this.items.push(txt);
      this.container.add(txt);

      const hit = this.scene.add.rectangle(
        MENU_WIDTH / 2,
        y + ITEM_HEIGHT / 2,
        MENU_WIDTH,
        ITEM_HEIGHT,
        0x000000,
        0,
      );
      hit.setInteractive({ useHandCursor: opt.enabled });
      hit.on("pointerover", () => {
        if (opt.enabled) {
          this.selectedIndex = i;
          this.updateHighlight();
        }
      });
      hit.on("pointerdown", () => {
        if (opt.enabled) {
          this.hide();
          opt.action();
        }
      });
      this.hitZones.push(hit);
      this.container.add(hit);
    }

    this.updateHighlight();

    const cam = this.scene.cameras.main;
    const screenX = (worldX - cam.scrollX) * cam.zoom;
    const screenY = (worldY - cam.scrollY) * cam.zoom;
    const menuX = Math.min(screenX - MENU_WIDTH / 2, cam.width - MENU_WIDTH - 10);
    const menuY = Math.max(screenY - totalH - 10, 10);

    this.container.setPosition(Math.max(menuX, 10), menuY);
    this.container.setVisible(true);
    this._visible = true;
  }

  hide() {
    this.container.setVisible(false);
    this._visible = false;
    this.clearItems();
  }

  update() {
    if (!this._visible) return;

    const elapsed = this.scene.game.getFrame() - this.openFrame;
    if (elapsed < 2) return;

    if (
      Phaser.Input.Keyboard.JustDown(this.upKey) ||
      Phaser.Input.Keyboard.JustDown(this.upArrow)
    ) {
      this.moveSelection(-1);
    } else if (
      Phaser.Input.Keyboard.JustDown(this.downKey) ||
      Phaser.Input.Keyboard.JustDown(this.downArrow)
    ) {
      this.moveSelection(1);
    }

    if (
      Phaser.Input.Keyboard.JustDown(this.confirmKey) ||
      Phaser.Input.Keyboard.JustDown(this.enterKey)
    ) {
      const opt = this.options[this.selectedIndex];
      if (opt?.enabled) {
        this.hide();
        opt.action();
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.hide();
      this.onClose?.();
    }
  }

  private moveSelection(dir: number) {
    const len = this.options.length;
    if (len === 0) return;
    let next = this.selectedIndex;
    for (let attempt = 0; attempt < len; attempt++) {
      next = (next + dir + len) % len;
      if (this.options[next].enabled) {
        this.selectedIndex = next;
        this.updateHighlight();
        return;
      }
    }
  }

  private updateHighlight() {
    for (let i = 0; i < this.highlights.length; i++) {
      const selected = i === this.selectedIndex && this.options[i]?.enabled;
      this.highlights[i].setVisible(selected);
      const opt = this.options[i];
      if (opt?.enabled) {
        this.items[i].setColor(selected ? TEXT_HIGHLIGHT : TEXT_COLOR);
      }
    }
  }

  private clearItems() {
    for (const t of this.items) t.destroy();
    for (const h of this.highlights) h.destroy();
    for (const z of this.hitZones) {
      z.removeAllListeners();
      z.destroy();
    }
    this.items = [];
    this.highlights = [];
    this.hitZones = [];
  }

  destroy() {
    this.clearItems();
    this.container.destroy();

    const kb = this.scene.input.keyboard;
    if (kb) {
      kb.removeKey(this.upKey, true);
      kb.removeKey(this.downKey, true);
      kb.removeKey(this.upArrow, true);
      kb.removeKey(this.downArrow, true);
      kb.removeKey(this.confirmKey, true);
      kb.removeKey(this.enterKey, true);
      kb.removeKey(this.escKey, true);
    }
    this.onClose = null;
  }
}
