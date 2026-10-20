"use client";

import * as React from "react";

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * D-015：当前时间 "HH:MM"（浏览器本地时间），每 10 秒检查一次。
 * Web 预览与 H5 看板用它模拟设备时钟区；首次渲染返回 null，避免服务端/客户端不一致。
 */
export function useClockText(): string | null {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    const tick = () => setText(hhmm(new Date()));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return text;
}
