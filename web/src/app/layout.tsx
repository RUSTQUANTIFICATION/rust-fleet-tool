import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rust Fleet Platform",
  description: "Fleet corrosion monitoring system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}