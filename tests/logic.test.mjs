import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeMessages,
  firstUnread,
  isNearBottom,
  safeLink,
  validateAttachment,
  shouldNotify,
} from "../src/lib/logic.ts";
const message = (id, time, sender = "other") => ({
  id,
  created_at: time,
  sender_id: sender,
  deleted_at: null,
});
test("realtime merges deduplicate and order simultaneous messages", () => {
  const a = message("a", "2026-01-01");
  const b = message("b", "2026-01-02");
  assert.deepEqual(
    mergeMessages([b], [a, b]).map((m) => m.id),
    ["a", "b"],
  );
  assert.equal(
    mergeMessages([a], [{ ...a, deleted_at: "now" }])[0].deleted_at,
    "now",
  );
});
test("first unread works for new account and skips own messages", () => {
  const a = message("a", "2026-01-01", "me"),
    b = message("b", "2026-01-02");
  assert.equal(firstUnread([a, b], "me", null).id, "b");
  assert.equal(firstUnread([a, b], "me", "2026-01-02"), undefined);
});
test("scroll boundary respects reading history", () => {
  assert.equal(isNearBottom(0, 1000, 500), false);
  assert.equal(isNearBottom(480, 1000, 500), true);
});
test("notification exclusions", () => {
  for (const key of ["own", "active", "muted", "blocked"])
    assert.equal(
      shouldNotify({
        own: false,
        active: false,
        muted: false,
        blocked: false,
        [key]: true,
      }),
      false,
    );
  assert.equal(
    shouldNotify({ own: false, active: false, muted: false, blocked: false }),
    true,
  );
});
test("unsafe links and oversized or active-content attachments rejected", () => {
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("https://example.com"), "https://example.com/");
  assert.throws(() => validateAttachment({ size: 1, type: "image/svg+xml" }));
  assert.throws(() =>
    validateAttachment({ size: 20971521, type: "image/png" }),
  );
  assert.doesNotThrow(() =>
    validateAttachment({ size: 200, type: "application/pdf" }),
  );
});
