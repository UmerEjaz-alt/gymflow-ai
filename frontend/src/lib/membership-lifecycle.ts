import type { Membership } from "@/types/membership";

export function membershipStatus(
  period: Pick<Membership, "start_date" | "expiry_date">,
  today: string,
) {
  if (period.start_date > today) return "Scheduled";
  return period.expiry_date < today ? "Expired" : "Active";
}

/** Current first, otherwise the nearest scheduled period, otherwise latest history. */
export function selectMemberships(periods: Membership[], today: string): Membership[] {
  const groups = new Map<string, Membership[]>();
  for (const period of periods) {
    const key = `${period.member_id ?? period.conversation_id ?? period.id}:${period.branch_id}`;
    groups.set(key, [...(groups.get(key) ?? []), period]);
  }
  return [...groups.values()].map((history) => {
    const active = history.filter((p) => membershipStatus(p, today) === "Active");
    const scheduled = history.filter((p) => membershipStatus(p, today) === "Scheduled");
    const candidates = active.length ? active : scheduled.length ? scheduled : history;
    return [...candidates].sort(
      (a, b) =>
        (active.length || !scheduled.length
          ? b.start_date.localeCompare(a.start_date)
          : a.start_date.localeCompare(b.start_date)) ||
        b.created_at.localeCompare(a.created_at) ||
        a.id.localeCompare(b.id),
    )[0];
  });
}

/** PostgreSQL calendar-month arithmetic, including Jan 31 -> Feb 28/29. */
export function membershipEndDate(start: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(months) || months < 1)
    return "";
  const [year, month, day] = start.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}
