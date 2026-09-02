"use client";

import type { ReactNode } from "react";

interface HudFlyoutProps {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}

export default function HudFlyout({
  title,
  subtitle,
  headerAction,
  children,
  bodyClass,
}: HudFlyoutProps) {
  return (
    <div className="hud-flyout">
      <div className="hud-flyout__header">
        <div className="hud-flyout__top-row">
          <div className="hud-flyout__title">{title}</div>
          {headerAction ?? null}
        </div>
        {subtitle ? <div className="hud-flyout__subtitle">{subtitle}</div> : null}
      </div>
      <div className={`hud-flyout__body ${bodyClass ?? ""}`}>{children}</div>
    </div>
  );
}
