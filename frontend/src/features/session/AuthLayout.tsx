/**
 * Two-panel auth layout: dark left (42%) + light right (58%).
 * Logo is a framed white badge — compact, not a full-width strip.
 * Media queries injected via <style> tag (inline styles cannot handle breakpoints).
 */

const FEATURES = [
  "AI-powered manuscript structuring",
  "End-to-end production workflow",
  "Publisher-grade quality controls",
] as const;

const css = `
  .auth-left  { display: flex; }
  .auth-right { width: 58%; }
  .auth-mobile-logo { display: none; }
  @media (max-width: 768px) {
    .auth-left  { display: none !important; }
    .auth-right { width: 100vw !important; }
    .auth-mobile-logo { display: block; }
  }
  @keyframes auth-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
`;

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <>
      <style>{css}</style>

      <div
        style={{
          display: "flex",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          margin: 0,
          padding: 0,
        }}
      >
        {/* ── LEFT PANEL ── */}
        <div
          className="auth-left"
          style={{
            width: "42%",
            height: "100vh",
            backgroundColor: "#1C1917",
            flexDirection: "column",
            padding: "40px 44px",
            boxSizing: "border-box",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* SECTION A — framed logo badge */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#FFFFFF",
                borderRadius: "8px",
                padding: "8px 16px",
              }}
            >
              <img
                src="/logo.png"
                alt="S4Carlisle Publishing Services"
                style={{ height: "48px", width: "auto", display: "block" }}
                draggable={false}
              />
            </div>
          </div>

          {/* SECTION B — editorial content, vertically centered */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            {/* Gold accent rule */}
            <div
              style={{
                width: "32px",
                height: "2px",
                backgroundColor: "#C9821A",
                marginBottom: "24px",
              }}
            />

            <h1
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "30px",
                fontWeight: 400,
                color: "#F5F1EB",
                lineHeight: 1.35,
                letterSpacing: "-0.01em",
                margin: "0 0 16px 0",
              }}
            >
              Publishing workflows,
              <br />
              powered by intelligence.
            </h1>

            <p
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "13px",
                color: "#6B6560",
                lineHeight: 1.75,
                margin: "0 0 40px 0",
                maxWidth: "285px",
              }}
            >
              The S4Carlisle Production Suite helps editorial teams manage
              manuscripts, automate processing, and deliver publication-ready
              content at scale.
            </p>

            {/* Feature list — gold dash motif */}
            <div>
              {FEATURES.map((text) => (
                <div
                  key={text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "14px",
                  }}
                >
                  <div
                    style={{
                      width: "18px",
                      height: "1.5px",
                      backgroundColor: "#C9821A",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontSize: "13px",
                      color: "#7C7370",
                    }}
                  >
                    {text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION C — copyright */}
          <div style={{ paddingTop: "24px" }}>
            <p
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "11px",
                color: "#3A3633",
                margin: 0,
                letterSpacing: "0.02em",
              }}
            >
              © 2026 S4Carlisle Publishing Services
            </p>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div
          className="auth-right"
          style={{
            height: "100vh",
            backgroundColor: "#F5F4F1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 64px",
            boxSizing: "border-box",
            overflowY: "auto",
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
