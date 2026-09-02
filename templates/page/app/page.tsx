"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { StudioProvider } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";
import TerminalModal from "@/components/panel/TerminalModal";
import WorkerSessionHistoryModal from "@/components/panel/WorkerSessionHistoryModal";
import PersonDetailModal from "@/components/panel/PersonDetailModal";
import ReassignModal from "@/components/panel/ReassignModal";
import PlayControlPanel from "@/components/panel/PlayControlPanel";
import AdminGateModal from "@/components/panel/AdminGateModal";
import GameHud from "@/components/hud/GameHud";
import { OfficeDataProvider, OfficeRosterSync, useOfficeData } from "@/lib/office-sync";
import { OperationLogProvider, useOperationLog } from "@/lib/operation-log";

const PhaserGame = dynamic(() => import("@/components/game/PhaserGame"), {
  ssr: false,
});

function OfficeSyncLogBridge() {
  const { snapshot } = useOfficeData();
  const { addLog } = useOperationLog();
  const lastKeyRef = useRef("");

  useEffect(() => {
    const key = `${snapshot.source}-${snapshot.members.length}-${snapshot.tasks.length}-${snapshot.projects.length}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    if (snapshot.source === "feishu") {
      addLog(`飞书数据已同步：${snapshot.members.length} 位成员 / ${snapshot.tasks.length} 条任务。`, "ok");
    }
  }, [addLog, snapshot]);

  return null;
}

export default function Page() {
  return (
    <ErrorBoundary>
      <StudioProvider>
        <OfficeDataProvider>
          <OperationLogProvider>
          <main
            className="relative w-screen h-screen overflow-hidden"
            style={{ background: "var(--pixel-bg)" }}
            >
              <OfficeRosterSync />
              <OfficeSyncLogBridge />
            {/* Game canvas: full screen background */}
            <div className="absolute inset-0">
              <div
                data-office-loading
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--pixel-text)",
                  fontSize: 14,
                  zIndex: 5,
                  pointerEvents: "none",
                }}
              >
                正在加载办公室场景…
              </div>
              <GameErrorBoundary>
                <PhaserGame />
              </GameErrorBoundary>
            </div>
            {/* HUD overlay: floating UI on top */}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
              <GameHud />
            </div>
            <TerminalModal />
            <WorkerSessionHistoryModal />
            <PersonDetailModal />
            <ReassignModal />
            <PlayControlPanel />
            <AdminGateModal />
          </main>
          </OperationLogProvider>
        </OfficeDataProvider>
      </StudioProvider>
    </ErrorBoundary>
  );
}

