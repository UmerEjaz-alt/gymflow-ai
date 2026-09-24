export type SmsSegmentEstimate = {
  encoding: "gsm7" | "ucs2";
  characterUnits: number;
  segmentCount: number;
};

const GSM7_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM7_EXTENSION = new Set(Array.from("\f^{}\\[~]|€"));

/** Estimates carrier SMS segmentation without truncating the message. */
export function estimateSmsSegments(text: string): SmsSegmentEstimate {
  let septets = 0;
  let gsm7 = true;
  for (const character of Array.from(text)) {
    if (GSM7_BASIC.has(character)) septets += 1;
    else if (GSM7_EXTENSION.has(character)) septets += 2;
    else {
      gsm7 = false;
      break;
    }
  }

  if (gsm7) {
    return {
      encoding: "gsm7",
      characterUnits: septets,
      segmentCount: Math.max(1, Math.ceil(septets / (septets <= 160 ? 160 : 153))),
    };
  }

  // Twilio's UCS-2 accounting follows UTF-16 code units; astral characters
  // such as emoji therefore consume two units.
  const units = text.length;
  return {
    encoding: "ucs2",
    characterUnits: units,
    segmentCount: Math.max(1, Math.ceil(units / (units <= 70 ? 70 : 67))),
  };
}
