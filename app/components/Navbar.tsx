"use client";

export default function Navbar() {
  return (
    <>
      <style>{`
        .nav-link {
          color: #8BA7C7;
          text-decoration: none;
          font-weight: 500;
          transition: color 0.15s;
        }
        .nav-link:hover {
          color: #FFFFFF;
        }
      `}</style>
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
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 60,
          }}
        >
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
            <a href="/" className="nav-link">
              Home
            </a>
            <span style={{ color: "#243550" }}>|</span>
            <a
              href="https://github.com/rishaanmarwaha-bot/judgeiq"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>
    </>
  );
}
