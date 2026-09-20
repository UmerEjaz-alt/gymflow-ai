export type AuthoritativeTurnIntent =
  | "joining"
  | "pricing"
  | "trainer"
  | "facility"
  | "media"
  | "policy"
  | "hours"
  | "general";

export type AuthoritativeEntityType = "facility" | "trainer" | "package";

export type AuthoritativeEntity = {
  type: AuthoritativeEntityType;
  id: string;
  name: string;
} | null;

export type EntityResolution = {
  entity: AuthoritativeEntity;
  source: "current" | "continuity" | "none";
};

export function classifyCurrentTurnIntent(input: {
  joiningSalesCue: boolean;
  needs: {
    all: boolean;
    packages: boolean;
    trainers: boolean;
    facilities: boolean;
    media: boolean;
    policies: boolean;
    openingHours: boolean;
    offers: boolean;
  };
  previousIntent: AuthoritativeTurnIntent | null;
}): AuthoritativeTurnIntent {
  if (input.joiningSalesCue) return "joining";
  if (input.needs.all) return input.previousIntent ?? "general";
  if (input.needs.trainers) return "trainer";
  if (input.needs.facilities) return "facility";
  if (input.needs.media) return "media";
  if (input.needs.packages || input.needs.offers) return "pricing";
  if (input.needs.openingHours) return "hours";
  if (input.needs.policies) return "policy";
  return input.previousIntent ?? "general";
}

export function normalizeEntityText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSingleTypoOrTransposition(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const differences = [...left].flatMap((character, index) =>
      character === right[index] ? [] : [index],
    );
    if (differences.length === 1) return true;
    return (
      differences.length === 2 &&
      differences[1] === differences[0]! + 1 &&
      left[differences[0]!] === right[differences[1]!] &&
      left[differences[1]!] === right[differences[0]!]
    );
  }

  const [shorter, longer] =
    left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    longIndex += 1;
  }
  return true;
}

export function resolveNamedEntity<T extends { id: string }>(
  text: string,
  items: T[],
  name: (item: T) => string,
  collapseEquivalentNames = false,
): T | null {
  const normalized = normalizeEntityText(text);
  const messageTokens = normalized.split(" ").filter(Boolean);
  const matches = items.filter((item) => {
    const itemName = normalizeEntityText(name(item));
    if (!itemName) return false;
    if (normalized.includes(itemName)) return true;
    const tokens = itemName.split(" ").filter((token) => token.length >= 3);
    return (
      tokens.length > 0 &&
      tokens.some(
        (token) =>
          normalized.includes(token) ||
          messageTokens.some((candidate) =>
            isSingleTypoOrTransposition(candidate, token),
          ),
      )
    );
  });
  if (matches.length === 1) return matches[0]!;

  if (
    collapseEquivalentNames &&
    matches.length > 1 &&
    new Set(matches.map((item) => normalizeEntityText(name(item)))).size === 1
  ) {
    return [...matches].sort((left, right) => left.id.localeCompare(right.id))[0]!;
  }

  return null;
}

export function resolveCurrentTurnState(input: {
  provisionalIntent: AuthoritativeTurnIntent;
  needsAll: boolean;
  mediaRequest: "none" | "gallery" | "entity" | "more";
  entityResolution: EntityResolution;
}): {
  intent: AuthoritativeTurnIntent;
  entity: AuthoritativeEntity;
} {
  let intent = input.provisionalIntent;
  let entity = input.entityResolution.entity;

  if (input.entityResolution.source === "current" && intent !== "joining") {
    intent =
      entity?.type === "trainer"
        ? "trainer"
        : entity?.type === "facility"
          ? "facility"
          : entity?.type === "package"
            ? "pricing"
            : intent;
  }

  if (
    input.entityResolution.source === "continuity" &&
    !input.needsAll &&
    input.mediaRequest !== "more" &&
    entity &&
    ((entity.type === "package" && intent !== "pricing" && intent !== "joining") ||
      (entity.type === "trainer" && intent !== "trainer") ||
      (entity.type === "facility" && intent !== "facility"))
  ) {
    entity = null;
  }

  return { intent, entity };
}
