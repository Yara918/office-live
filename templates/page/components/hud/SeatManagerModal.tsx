"use client";

import "./seat-manager.css";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useStudio } from "@/lib/store";
import type { SeatState } from "@/types/game";
import CharacterPortrait from "./CharacterPortrait";

/**
 * 成员外观设置：表格里的成员可换头像外观；空工位保留显示（不可手动安排）。
 * 成员名单完全来自飞书表格（由 OfficeRosterSync 同步到工位）。
 */

const SPRITE_LABELS: Record<string, string> = {
  character_02: "成员 A",
  character_03: "成员 B",
  character_04: "成员 C",
  character_05: "成员 D",
  character_06: "成员 E",
  character_01: "成员 F",
  character_09: "成员 G",
};

const SPRITES = [
  { key: "character_02", path: "/characters/Premade_Character_48x48_02.png" },
  { key: "character_03", path: "/characters/Premade_Character_48x48_03.png" },
  { key: "character_04", path: "/characters/Premade_Character_48x48_04.png" },
  { key: "character_05", path: "/characters/Premade_Character_48x48_05.png" },
  { key: "character_06", path: "/characters/Premade_Character_48x48_06.png" },
  { key: "character_01", path: "/characters/Premade_Character_48x48_01.png" },
  { key: "character_09", path: "/characters/Premade_Character_48x48_09.png" },
];

export default function SeatManagerModal({
  open,
  onClose,
  seats,
}: {
  open: boolean;
  onClose: () => void;
  seats: SeatState[];
}) {
  const { updateSeatConfig } = useStudio();
  const [selectedSeatId, setSelectedSeatId] = useState<string>("");
  // 草稿：选中但未保存的外观（key, path）；null 表示未改动
  const [draftSprite, setDraftSprite] = useState<{ key: string; path: string } | null>(null);
  // 保存反馈提示
  const [savedHint, setSavedHint] = useState<string>("");

  const assignedCount = seats.filter((seat) => seat.assigned).length;
  const selectedSeat =
    seats.find((seat) => seat.seatId === selectedSeatId) ??
    seats.find((seat) => seat.assigned) ??
    seats[0];

  useEffect(() => {
    if (open && seats.length > 0 && !seats.some((s) => s.seatId === selectedSeatId)) {
      setSelectedSeatId(seats.find((seat) => seat.assigned)?.seatId ?? seats[0].seatId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seats.length]);

  // 切换成员时重置草稿和提示
  useEffect(() => {
    setDraftSprite(null);
    setSavedHint("");
  }, [selectedSeatId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !selectedSeat) return null;

  const seat = selectedSeat;
  // 展示中的外观：优先草稿，其次已保存的
  const displaySprite = draftSprite ?? {
    key: seat.spriteKey ?? "",
    path: seat.spritePath ?? "",
  };
  const hasChange = draftSprite !== null && draftSprite.key !== (seat.spriteKey ?? "");

  const saveSprite = () => {
    if (!seat.assigned || !draftSprite) return;
    updateSeatConfig(seat.seatId, {
      spriteKey: draftSprite.key,
      spritePath: draftSprite.path,
    });
    setSavedHint(`已保存「${seat.label}」的外观`);
    setDraftSprite(null);
  };

  return (
    <div
      className="seat-manager-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="seat-manager pixel-panel">
        {/* Header */}
        <div className="seat-manager__header">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--pixel-text)" }}>成员外观设置</div>
              <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4 }}>
                {seats.length} 个工位 · {assignedCount} 位成员（来自飞书表格）· 空位需在表格添加成员
              </div>
            </div>
          </div>
          <button
            type="button"
            className="pixel-icon-btn"
            style={{ width: 38, height: 38, minWidth: 38, minHeight: 38 }}
            onClick={onClose}
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Left: seat list (all seats, empty seats shown) */}
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingRight: 4,
          }}
        >
          {seats.map((item, index) => {
            const active = item.seatId === seat.seatId;
            return (
              <button
                key={item.seatId}
                type="button"
                className={`seat-card ${active ? "seat-card--active" : ""}`}
                onClick={() => setSelectedSeatId(item.seatId)}
              >
                <div className="seat-card__info">
                  <div className="seat-manager__portrait-frame seat-manager__portrait-frame--small">
                    {item.assigned && item.spritePath ? (
                      <CharacterPortrait spritePath={item.spritePath} name={item.label} />
                    ) : (
                      <span style={{ fontSize: 8, color: "var(--pixel-muted)" }}>空位</span>
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 8, color: "var(--pixel-muted)" }}>工位 {index + 1}</div>
                    <div
                      style={{
                        fontSize: 10,
                        marginTop: 4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.assigned ? item.label : "空位"}
                    </div>
                    <div style={{ fontSize: 8, color: "var(--pixel-muted)", marginTop: 4 }}>
                      {item.assigned ? (item.roleTitle ?? "成员") : "表格加人后自动安排"}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: detail + sprite picker */}
        <div
          style={{
            minHeight: 0,
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "auto auto 1fr auto",
            gap: 12,
          }}
        >
          {seat.assigned ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12 }}>
                <div className="seat-manager__portrait-frame seat-manager__portrait-frame--large">
                  {displaySprite.path ? (
                    <CharacterPortrait spritePath={displaySprite.path} name={seat.label} large />
                  ) : (
                    <div style={{ fontSize: 8, color: "var(--pixel-muted)" }}>未设置外观</div>
                  )}
                </div>
                <div className="hud-panel__stack" style={{ gap: 8 }}>
                  <div style={{ fontSize: 12 }}>{seat.label}</div>
                  <div style={{ fontSize: 8, color: "var(--pixel-muted)" }}>
                    {seat.roleTitle ?? "成员"} · 来自飞书表格
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      padding: "4px 8px",
                      alignSelf: "flex-start",
                      background: "rgba(255,255,255,0.06)",
                      color: "var(--pixel-text)",
                    }}
                  >
                    在飞书表格修改姓名/角色后，这里会自动更新
                  </div>
                  {savedHint && (
                    <div
                      style={{
                        fontSize: 8,
                        padding: "4px 8px",
                        alignSelf: "flex-start",
                        background: "rgba(74, 222, 128, 0.16)",
                        color: "var(--pixel-green)",
                      }}
                    >
                      ✓ {savedHint}
                    </div>
                  )}
                </div>
              </div>

              <div className="seat-hint">从 7 个人物外观中选一个，然后点「保存外观」生效。</div>

              <div
                style={{
                  minHeight: 0,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 10,
                }}
              >
                {SPRITES.map((sprite) => {
                  const active = (draftSprite?.key ?? seat.spriteKey ?? "") === sprite.key;
                  return (
                    <button
                      key={sprite.key}
                      type="button"
                      className={`pixel-button ${active ? "pixel-button--primary" : ""}`}
                      style={{ padding: 8, textAlign: "center" }}
                      onClick={() => {
                        setDraftSprite({ key: sprite.key, path: sprite.path });
                        setSavedHint("");
                      }}
                    >
                      <div
                        className="seat-manager__portrait-frame seat-manager__portrait-frame--small"
                        style={{ margin: "0 auto 6px" }}
                      >
                        <CharacterPortrait
                          spritePath={sprite.path}
                          name={SPRITE_LABELS[sprite.key] ?? "成员"}
                        />
                      </div>
                      <div style={{ fontSize: 8 }}>
                        {SPRITE_LABELS[sprite.key] ?? "成员"}
                        {active ? " ✓" : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div
              className="seat-hint"
              style={{ alignSelf: "center", textAlign: "center", padding: 24 }}
            >
              这是空工位。
              <br />
              在飞书多维表格的「人员表」添加成员后，会自动出现在这里，并可直接换外观。
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {seat.assigned ? (
              <button
                type="button"
                className="pixel-button pixel-button--primary"
                onClick={saveSprite}
                disabled={!hasChange}
              >
                {hasChange ? "保存外观" : "已保存"}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="pixel-button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
