import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

const rounded = localFont({
  src: [
    { path: "./fonts/mplus-rounded-1c/MPLUSRounded1c-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/mplus-rounded-1c/MPLUSRounded1c-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/mplus-rounded-1c/MPLUSRounded1c-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/mplus-rounded-1c/MPLUSRounded1c-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "./fonts/mplus-rounded-1c/MPLUSRounded1c-Black.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "CarePact",
  description:
    "親の介護に直面した家族が、介護保険の数字を見ながら全員で納得して介護体制を決めるための家族専用意思決定ボード",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${rounded.className} bg-white text-neutral-900 antialiased`}>{children}</body>
    </html>
  );
}
