"use client";

import "./onboarding.css";

import { useState, useEffect, useRef, useCallback } from "react";
import { useStudio } from "@/lib/store";
import { saveOnboardingDone } from "@/lib/persistence";

interface Props {
  onDone: () => void;
}

export default function OnboardingOverlay({ onDone }: Props) {
  const { state } = useStudio();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef(0);

  const finish = useCallback(() => {
    saveOnboardingDone();
    onDone();
  }, [onDone]);

  useEffect(() => {
    if (state.connection === "connected") {
      const t = setTimeout(finish, 800);
      return () => clearTimeout(t);
    }
  }, [state.connection, finish]);

  useEffect(() => {
    function track() {
      const el = document.querySelector<HTMLElement>('[data-dock-id="connection"]');
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) => {
          if (
            !prev ||
            Math.abs(prev.x - r.x) > 1 ||
            Math.abs(prev.y - r.y) > 1 ||
            Math.abs(prev.width - r.width) > 1
          ) {
            return r;
          }
          return prev;
        });
      }
      rafRef.current = requestAnimationFrame(track);
    }
    rafRef.current = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!rect) return null;

  const pad = 6;
  const spotX = rect.left - pad;
  const spotY = rect.top - pad;
  const spotW = rect.width + pad * 2;
  const spotH = rect.height + pad * 2;

  const tooltipW = 240;
  const tooltipX = spotX + spotW / 2 - tooltipW / 2;
  const tooltipY = spotY - 72;

  return (
    <>
      {/* Dark overlay with cutout */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          background: "rgba(0,0,0,0.7)",
          pointerEvents: "auto",
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${spotX}px ${spotY}px,
            ${spotX}px ${spotY + spotH}px,
            ${spotX + spotW}px ${spotY + spotH}px,
            ${spotX + spotW}px ${spotY}px,
            ${spotX}px ${spotY}px
          )`,
        }}
        onClick={finish}
      />

      {/* Pulsing ring around the button */}
      <div
        style={{
          position: "fixed",
          left: spotX,
          top: spotY,
          width: spotW,
          height: spotH,
          zIndex: 91,
          border: "2px solid #facc15",
          borderRadius: "var(--pixel-radius)",
          boxShadow: "0 0 12px rgba(250,204,21,0.5), inset 0 0 8px rgba(250,204,21,0.15)",
          pointerEvents: "none",
          animation: "onboarding-pulse 1.5s ease-in-out infinite",
        }}
      />

      {/* Tooltip */}
      <div
        style={{
          position: "fixed",
          left: tooltipX,
          top: tooltipY,
          width: tooltipW,
          zIndex: 91,
          background: "rgba(22,33,62,0.96)",
          border: "3px solid #0f3460",
          borderRadius: "var(--pixel-radius)",
          padding: "12px 14px",
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-ark-pixel, "ArkPixel", monospace)',
            fontSize: 12,
            lineHeight: 1.8,
            color: "#e2e8f0",
            margin: 0,
            textShadow: "0.5px 0 0 currentColor",
          }}
        >
          先用键盘移动老板，靠近员工后按{" "}
          <strong style={{ color: "var(--pixel-accent)" }}>E</strong> 安排任务
        </p>
        {/* Arrow pointing down */}
        <div
          style={{
            position: "absolute",
            bottom: -10,
            left: "50%",
            marginLeft: -6,
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "10px solid #0f3460",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -7,
            left: "50%",
            marginLeft: -4,
            width: 0,
            height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "7px solid rgba(22,33,62,0.96)",
          }}
        />
      </div>

      {/* Skip text */}
      <div
        style={{
          position: "fixed",
          left: tooltipX,
          top: tooltipY - 28,
          width: tooltipW,
          zIndex: 91,
          textAlign: "center",
        }}
      >
        <button
          type="button"
          onClick={finish}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            fontFamily: 'var(--font-pixel), "ArkPixel", monospace',
            fontSize: 8,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
            padding: 4,
            pointerEvents: "auto",
          }}
        >
          知道了
        </button>
      </div>
    </>
  );
}
