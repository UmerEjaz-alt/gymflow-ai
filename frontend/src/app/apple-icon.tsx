import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#050506",
        color: "#f4f3ef",
        fontSize: 96,
        fontWeight: 900,
        letterSpacing: "-0.08em",
      }}
    >
      K
    </div>,
    size,
  );
}
