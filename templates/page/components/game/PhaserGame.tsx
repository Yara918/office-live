"use client";

import { useEffect, useRef } from "react";
import type * as PhaserTypes from "phaser";
import { createLogger } from "@/lib/logger";

const log = createLogger("PhaserGame");

export default function PhaserGame() {
  const gameRef = useRef<PhaserTypes.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function initGame() {
      if (!containerRef.current) return;

      const { gameConfig } = await import("./config");
      const Phaser = await import("phaser");

      if (!mounted) return;

      const game = new Phaser.Game({
        ...gameConfig,
        parent: containerRef.current,
      });
      gameRef.current = game;
      // 调试用：暴露 game 实例便于检查场景状态
      (window as unknown as { __officeGame?: unknown }).__officeGame = game;
    }

    initGame().catch((err) => {
      log.error("init failed:", err);
    });

    return () => {
      mounted = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        imageRendering: "pixelated",
      }}
    />
  );
}
