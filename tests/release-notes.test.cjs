const assert = require("node:assert/strict");
const { test } = require("node:test");
const { items } = require("../release-notes.js");

test("reads the same human bullets supplied to signer apps", () => {
  assert.deepEqual(items("• Logos are remembered when you return.\n• Search takes you back to the genre list."),
    ["Logos are remembered when you return.", "Search takes you back to the genre list."]);
});
test("does not display build metadata or diagnostic lines as notes", () => {
  for (const text of ["Unsigned IPA from successful main build abc1234. Sign before installing.",
    "• error: invalid redeclaration of actual", "• Source-SHA: abc1234",
    "• Release notes for this build are being prepared."]) assert.deepEqual(items(text), []);
});
test("keeps markup literal so the page can render it with textContent", () => {
  const text = "An imported title named <img src=x onerror=alert(1)> now opens correctly.";
  assert.deepEqual(items("• " + text), [text]);
});
test("ignores empty or excessive content", () => {
  assert.deepEqual(items(null), []);
  assert.deepEqual(items(""), []);
  assert.deepEqual(items("x".repeat(12001)), []);
});
