import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CineSync AI — Speech-to-Speech Dub Editor",
  description:
    "Cinematic dub editor for Indian film production teams. Convert your performance into licensed target voices while preserving emotion and timing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="grain antialiased min-h-screen">{children}</body>
    </html>
  );
}
