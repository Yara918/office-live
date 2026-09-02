"use client";

import { useEffect, useState } from "react";
import { X, Eye, EyeOff } from "lucide-react";
import { useOfficeData } from "@/lib/office-sync";
import { OFFICE_CONFIG } from "@/lib/office-config";
import { gameEvents } from "@/lib/events";

/**
 * 管理员口令门（按需弹出）：
 * 任何"改动表格"的操作（点 E / 调整负责人 / 新增事项等）触发 request-admin 事件，
 * 未解锁时弹出口令输入；验证通过后解锁，后续操作直接放行。
 * 输入框用 type=text（中文输入法可正常上屏），支持显示/隐藏切换；
 * 提示语绝不透露口令内容。
 */
export default function AdminGateModal() {
  const { isAdmin, unlockAdmin } = useOfficeData();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [show, setShow] = useState(true);

  useEffect(() => {
    return gameEvents.on("request-admin", () => {
      setCode("");
      setWrong(false);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (isAdmin) setOpen(false);
  }, [isAdmin]);

  if (!open) return null;

  const submit = () => {
    const ok = unlockAdmin(code);
    if (!ok) {
      setWrong(true);
      setCode("");
    } else {
      // 解锁成功：通知等待中的面板自动打开（如"建议调整负责人"）
      gameEvents.emit("admin-unlocked");
    }
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 200, background: "rgba(0,0,0,0.55)", pointerEvents: "auto", padding: 20 }}
    >
      <div className="pixel-panel" style={{ width: "min(380px, 92vw)", padding: 18 }}>
        <div className="flex items-start justify-between" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>管理员验证</div>
          <button
            className="pixel-icon-btn"
            onClick={() => setOpen(false)}
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 9, color: "var(--pixel-muted)", marginBottom: 12 }}>
          调整负责人、安排事项等会改动表格的操作，需要管理员口令。
          <br />
          口令请联系表格维护人获取。
        </div>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input
            className="pixel-input hud-panel__input"
            type={show ? "text" : "password"}
            value={code}
            placeholder="请输入管理口令"
            onChange={(event) => {
              setCode(event.target.value);
              setWrong(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            style={{ paddingRight: 36 }}
            autoFocus
          />
          <button
            type="button"
            className="pixel-icon-btn"
            onClick={() => setShow((v) => !v)}
            title={show ? "隐藏口令" : "显示口令（可输中文）"}
            style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 28, height: 28 }}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {wrong && (
          <div style={{ fontSize: 9, color: "var(--pixel-red)", marginBottom: 8 }}>
            口令不正确，请重试。
          </div>
        )}
        <button
          className="pixel-button pixel-button--primary w-full"
          style={{ marginTop: 4 }}
          onClick={submit}
        >
          验证
        </button>
      </div>
    </div>
  );
}
