import "./globals.css";
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Parade Suite",
  description: "Parade and Ceremonial Music Management System",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Parade Suite",
    description: "Parade and Ceremonial Music Management System",
    type: "website",
    siteName: "Parade Suite",
  },
  twitter: {
    card: "summary",
    title: "Parade Suite",
    description: "Parade and Ceremonial Music Management System",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
