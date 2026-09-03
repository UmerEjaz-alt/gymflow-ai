import { ImageResponse } from "next/og";

export const alt = "Kroway — AI-powered front desk for modern gyms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "66px 72px",
        background: "#050506",
        color: "#f4f3ef",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 31, fontWeight: 900, letterSpacing: "-0.04em" }}>
          KROWAY
        </div>
        <div
          style={{
            fontSize: 14,
            color: "rgba(244,243,239,.46)",
            letterSpacing: ".16em",
          }}
        >
          FOR GYMS
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            width: 72,
            height: 2,
            marginBottom: 28,
            background: "#7e271b",
          }}
        />
        <div
          style={{
            maxWidth: 970,
            fontSize: 82,
            lineHeight: 0.92,
            fontWeight: 900,
            letterSpacing: "-0.06em",
          }}
        >
          YOUR GYM CLOSES. YOUR FRONT DESK DOESN&apos;T HAVE TO.
        </div>
      </div>
      <div
        style={{
          fontSize: 17,
          color: "rgba(244,243,239,.52)",
          letterSpacing: ".02em",
        }}
      >
        AI-powered WhatsApp front desk for modern gyms.
      </div>
    </div>,
    size,
  );
}
