type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function parseLocalInput(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (!year || !month || !day || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

function partsAt(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function asUtc(parts: LocalParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameParts(left: LocalParts, right: LocalParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/** Converts a wall-clock datetime in an IANA zone to its exact UTC instant.
 * DST gaps are rejected; repeated fall-back times deterministically use the
 * first occurrence. */
export function zonedLocalInputToIso(value: string, timeZone: string): string | null {
  const wanted = parseLocalInput(value);
  if (!wanted) return null;
  try {
    let instant = asUtc(wanted);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actual = partsAt(new Date(instant), timeZone);
      if (sameParts(actual, wanted)) return new Date(instant).toISOString();
      instant += asUtc(wanted) - asUtc(actual);
    }
  } catch {
    return null;
  }
  return null;
}

export function isoToZonedLocalInput(value: string, timeZone: string): string {
  const parts = partsAt(new Date(value), timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}T${parts.hour.toString().padStart(2, "0")}:${parts.minute.toString().padStart(2, "0")}`;
}
