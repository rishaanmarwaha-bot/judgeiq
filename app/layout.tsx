import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "./components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JudgeIQ - Judging Analytics for Competitive Debate",
  description:
    "JudgeIQ — Intelligent judging analytics for competitive debate. Detect bias, score consistency, and surface outliers from any tournament data.",
  keywords: ["debate", "competition", "judge", "analytics", "adjudication", "scoring"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={inter.className}
        style={{ background: "#0F1B2D", color: "#FFFFFF", margin: 0, padding: 0, WebkitFontSmoothing: "antialiased" }}
      >
        <Navbar />

        <main>{children}</main>

        <footer
          style={{
            borderTop: "1px solid #243550",
            marginTop: 80,
            padding: "36px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#4A6380", fontSize: 13, margin: 0 }}>
            <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Judge</span>
            <span style={{ color: "#C9A84C", fontWeight: 700 }}>IQ</span>
            {" "}— Intelligent judging analytics for competitive debate.
          </p>
          <p style={{ color: "#4A6380", fontSize: 12, marginTop: 6 }}>
            Bias detection · Severity scoring · Tab-room recommendations · Built with Next.js, TypeScript &amp; Recharts
          </p>
        </footer>
      </body>
    </html>
  );
}
