import * as Phaser from "phaser";

const BUBBLE_MAX_WIDTH = 300;
const FADE_DURATION = 400;
const DEFAULT_TTL = 5000;

export class ChatBubble {
  private el: HTMLDivElement;
  private scene: Phaser.Scene;
  private worldX = 0;
  private worldY = 0;
  private _visible = false;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeRaf: ReturnType<typeof requestAnimationFrame> | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.el = document.createElement("div");
    this.el.className = "game-bubble";
    this.el.style.cssText = `
      position: absolute;
      pointer-events: none;
      max-width: ${BUBBLE_MAX_WIDTH}px;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(26, 26, 46, 0.3);
      color: #1a1a2e;
      font-family: var(--pixel-font-chat);
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
      transform: translate(-50%, -100%);
      z-index: 15;
      opacity: 0;
      transition: opacity ${FADE_DURATION}ms ease;
      display: none;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
    `;

    // Tail
    const tail = document.createElement("div");
    tail.style.cssText = `
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid rgba(255, 255, 255, 0.95);
    `;
    this.el.appendChild(tail);

    // Mount into the game's parent container
    const parent = scene.game.canvas.parentElement;
    if (parent) {
      parent.style.position = "relative";
      parent.appendChild(this.el);
    }
  }

  show(message: string, anchorX: number, anchorY: number, ttl = DEFAULT_TTL) {
    this.clearTimers();

    const displayText = message.length > 100 ? message.slice(0, 97) + "..." : message;

    // Set text (first child is text node, then tail div)
    const existing = this.el.firstChild;
    if (existing && existing.nodeType === Node.TEXT_NODE) {
      existing.textContent = displayText;
    } else {
      this.el.insertBefore(document.createTextNode(displayText), this.el.firstChild);
    }

    this.worldX = anchorX;
    this.worldY = anchorY;
    this._visible = true;

    this.el.style.display = "block";
    // Force reflow then show
    void this.el.offsetHeight;
    this.el.style.opacity = "1";

    this.syncPosition();

    if (ttl > 0) {
      this.fadeTimeout = setTimeout(() => {
        this.fadeTimeout = null;
        this.el.style.opacity = "0";
        this.fadeTimeout = setTimeout(() => {
          this.el.style.display = "none";
          this._visible = false;
        }, FADE_DURATION);
      }, ttl);
    }
  }

  updatePosition(anchorX: number, anchorY: number) {
    this.worldX = anchorX;
    this.worldY = anchorY;
    if (this._visible) this.syncPosition();
  }

  hide() {
    this.clearTimers();
    this.el.style.opacity = "0";
    this.el.style.display = "none";
    this._visible = false;
  }

  destroy() {
    this.clearTimers();
    this.el.remove();
  }

  private syncPosition() {
    const cam = this.scene.cameras.main;
    // World → screen: account for camera scroll, zoom, and viewport origin
    const sx = (this.worldX - cam.worldView.x) * cam.zoom + cam.x;
    const sy = (this.worldY - cam.worldView.y) * cam.zoom + cam.y;
    this.el.style.left = `${sx}px`;
    this.el.style.top = `${sy}px`;
  }

  private clearTimers() {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
    if (this.fadeRaf) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
  }
}
