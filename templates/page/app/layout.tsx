import type { Metadata } from "next";
import localFont from "next/font/local";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

const arkPixel = localFont({
  src: "../public/fonts/ark-pixel-12px.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-ark-pixel",
});

const pressStart2P = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Office Live 工作小剧场",
  description: "由飞书多维表格数据驱动的办公室互动工作小剧场",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`dark ${pressStart2P.variable} ${arkPixel.variable}`}>
      <body>{children}</body>
    </html>
  );
}
