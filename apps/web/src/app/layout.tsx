import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KidBoard",
  description: "家庭儿童墨水屏日程任务终端 — 家长端 PWA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
