import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
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
        fontSize: 35,
        fontWeight: 900,
        letterSpacing: "-0.08em",
      }}
    >
      K
    </div>,
    size,
  );
}
