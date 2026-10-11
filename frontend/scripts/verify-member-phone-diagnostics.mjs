import assert from "node:assert/strict";
import { normalizePhoneNumber } from "../src/lib/phone-number.ts";
import { phoneShape } from "../src/lib/member-phone-diagnostics.ts";

// Reproduce the confirmed live value shapes using synthetic numbers only.
const local = "03001234567";
assert.equal(normalizePhoneNumber(local, null).e164, null);
assert.match(normalizePhoneNumber(local, null).error, /configure this branch/);
assert.equal(normalizePhoneNumber(local, "PK").e164, "+923001234567");
assert.equal(normalizePhoneNumber("+923001234567", null).e164, "+923001234567");
assert.equal(normalizePhoneNumber("03001234567\\", null).e164, null);
assert.deepEqual(phoneShape(local).nonDigitCodePoints, []);
assert.deepEqual(phoneShape("03001234567\\").nonDigitCodePoints, ["U+5C"]);
assert(phoneShape(" 03001234567 ").outerWhitespace);
assert(phoneShape("0300\u200B1234567").nonDigitCodePoints.includes("U+200B"));
for (const value of [local, "+923001234567", "923001234567", "03001234567\\"]) {
  assert(!JSON.stringify(phoneShape(value)).includes(value));
}
console.log(
  "PASS: confirmed leading-zero/null-country failure, configured-country normalization, invalid/hidden-character diagnostics and phone-free shape output.",
);
