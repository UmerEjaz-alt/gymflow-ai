/** Lightweight routing cues, not a replacement for the main LLM understanding. */
export function normalizeIntentText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function damerauDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const mismatches = [...left].reduce<number[]>((positions, character, index) => {
      if (character !== right[index]) positions.push(index);
      return positions;
    }, []);

    if (mismatches.length <= 1) return true;
    if (mismatches.length !== 2 || mismatches[1] !== mismatches[0] + 1) return false;

    const [first, second] = mismatches;
    return left[first] === right[second] && left[second] === right[first];
  }

  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  for (let skipIndex = 0; skipIndex < longer.length; skipIndex += 1) {
    if (longer.slice(0, skipIndex) + longer.slice(skipIndex + 1) === shorter) {
      return true;
    }
  }
  return false;
}

/** Conservative positive cue for a customer trying to begin a gym membership. */
export function hasJoiningSalesCue(value: string): boolean {
  const text = normalizeIntentText(value);
  if (!text) return false;
  if (
    /\b(want|wanna|need|looking to|how do i)\s+(to )?(join|enroll|enrol|sign up|start)\b/.test(
      text,
    )
  )
    return true;
  if (
    /\b(membership|admission)\s+(leni|lena|chahiye|chahta|chahti|lenay|please|now)\b/.test(
      text,
    )
  )
    return true;
  if (
    /\b(gym\s+(join|start)\s*(karna|krna|karni)?|join\s*(karna|krna)|admission\s*(lena|leni))\b/.test(
      text,
    )
  )
    return true;
  if (/\b(sign up|enroll|enrol|membership|admission)\b/.test(text)) return true;

  const words = text.split(" ");
  const hasGymContext = /\b(gym|membership|admission|start|fitness)\b/.test(text);
  return (
    hasGymContext &&
    words.some(
      (word) =>
        word.length >= 3 &&
        word.length <= 7 &&
        (damerauDistanceAtMostOne(word, "join") ||
          damerauDistanceAtMostOne(word, "joining")),
    )
  );
}
