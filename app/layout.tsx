import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Parade Suite v0.104",
  description: "Parade music sequence manager",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
