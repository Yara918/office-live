"use client";

import "./hud.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import { useBgm } from "@/lib/useBgm";
import { saveOnboardingDone } from "@/lib/persistence";
import { withBase } from "@/lib/base-path";
import type { HudDockItem, HudPanelId } from "./HudDock";
import TopBar from "./TopBar";
import BottomBar from "./BottomBar";
import OperationLogPanel from "./OperationLogPanel";
import TaskPanel from "./TaskPanel";
import WorkerPanel from "./WorkerPanel";
import SeatManagerModal from "./SeatManagerModal";
import MusicControls from "./MusicControls";
import OnboardingOverlay from "./OnboardingOverlay";

export default function GameHud() {
  const { state } = useStudio();
  const bgm = useBgm();
  const [openPanel, setOpenPanel] = useState<HudPanelId | null>(null);
  const [seatManagerOpen, setSeatManagerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (showOnboarding && openPanel === "connection") {
      setShowOnboarding(false);
      saveOnboardingDone();
    }
  }, [showOnboarding, openPanel]);

  const toolItems: HudDockItem[] = useMemo(
    () => [
      {
        id: "music",
        label: "音乐",
        icon: withBase("/ui/icons/icon-music.png"),
        iconActive: withBase("/ui/icons/icon-music-active.png"),
      },
      {
        id: "tasks",
        label: "任务",
        icon: withBase("/ui/icons/icon-tasks.png"),
        iconActive: withBase("/ui/icons/icon-tasks-active.png"),
      },
      {
        id: "workers",
        label: "成员",
        icon: withBase("/ui/icons/icon-workers.png"),
        iconActive: withBase("/ui/icons/icon-workers-active.png"),
      },
    ],
    [],
  );

  const togglePanel = useCallback((id: HudPanelId) => {
    if (id === "workers") {
      setSeatManagerOpen((prev) => !prev);
      return;
    }
    setOpenPanel((current) => (current === id ? null : id));
  }, []);

  const musicIconOverrides = useMemo(
    () =>
      bgm.volume <= 0 ? { music: withBase("/ui/icons/icon-music-muted.png") as string } : undefined,
    [bgm.volume],
  );

  const topRightPanelOpen = openPanel && openPanel !== "chat";

  return (
    <div className="hud-overlay">
      <TopBar
        seats={state.seats}
        toolItems={toolItems}
        openPanel={openPanel}
        onToggle={togglePanel}
        iconOverrides={musicIconOverrides}
        onSeatClick={(seatId) => gameEvents.emit("open-person-detail", seatId)}
      />

      {topRightPanelOpen && (
        <div className="hud-topright-flyout">
          {openPanel === "music" ? <MusicControls bgm={bgm} /> : null}
          {openPanel === "tasks" ? <TaskPanel /> : null}
          {openPanel === "workers" ? (
            <WorkerPanel seats={state.seats} onOpenManager={() => setSeatManagerOpen(true)} />
          ) : null}
        </div>
      )}

      <div className="layout-bottom">
        <BottomBar seats={state.seats} />

        <div style={{ flex: "1 1 auto" }} />

        <div className="hud-chat-dock">
          {openPanel === "chat" && (
            <div className="hud-chat-dock__panel">
              <OperationLogPanel />
            </div>
          )}
          <button
            type="button"
            className={`hud-chat-dock__btn ${openPanel === "chat" ? "hud-chat-dock__btn--active" : ""}`}
            onClick={() => togglePanel("chat")}
            title="互动记录"
          >
            <img
              src={
                openPanel === "chat"
                  ? withBase("/ui/icons/icon-chat-active.png")
                  : withBase("/ui/icons/icon-chat.png")
              }
              alt="互动记录"
              width={28}
              height={28}
              style={{ imageRendering: "pixelated" }}
            />
            <span className="hud-chat-dock__label">记录</span>
          </button>
        </div>
      </div>

      <SeatManagerModal
        open={seatManagerOpen}
        onClose={() => setSeatManagerOpen(false)}
        seats={state.seats}
      />

      {showOnboarding && <OnboardingOverlay onDone={() => setShowOnboarding(false)} />}
    </div>
  );
}
