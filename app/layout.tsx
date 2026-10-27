import type { Metadata } from "next";
import "./globals.css";
import PointerGlow from "@/components/pointer-glow";

export const metadata: Metadata = {
  title: "Trading Arena | Performance, without the noise",
  description: "A focused trading community for trader profiles, leaderboards, and performance tracking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<PointerGlow /></body>
    </html>
  );
}
