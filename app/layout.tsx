import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Parade Suite",
  description: "Parade and Ceremonial Music Management System",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
