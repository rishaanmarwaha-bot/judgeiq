import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
        {/* Navigation */}
        <nav
          style={{
            borderBottom: "1px solid #243550",
            background: "rgba(15,27,45,0.85)",
            backdropFilter: "blur(12px)",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "#C9A84C",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0F1B2D",
                  fontWeight: 800,
                  fontSize: 16,
                  letterSpacing: "-0.02em",
                }}
              >
                J
              </div>
              <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>
                Judge<span style={{ color: "#C9A84C" }}>IQ</span>
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 14 }}>
              <a
                href="/"
                style={{ color: "#8BA7C7", textDecoration: "none", fontWeight: 500, transition: "color 0.15s" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#FFFFFF")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#8BA7C7")}
              >
                Home
              </a>
              <span style={{ color: "#243550" }}>|</span>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#8BA7C7", textDecoration: "none", transition: "color 0.15s" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#FFFFFF")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#8BA7C7")}
              >
                GitHub
              </a>
            </div>
          </div>
        </nav>

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
            Built with Next.js, Python, Pandas, SciPy &amp; Recharts
          </p>
        </footer>
      </body>
    </html>
  );
}
