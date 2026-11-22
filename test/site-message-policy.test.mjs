import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SITE_TEXT_CHARS, acceptSiteMessage } from "../extension/site-message-policy.js";

const RUNTIME = "abcdefghijklmnopabcdefghijklmnop";
const JOB = "bridge-job-1";

function context(overrides = {}) {
  return {
    senderId: RUNTIME,
    runtimeId: RUNTIME,
    senderTabId: 7,
    jobTabs: new Map([[JOB, 7]]),
    ...overrides,
  };
}

test("accepts a chunk from the tab that received the job and forwards only validated fields", () => {
  const accepted = acceptSiteMessage({ type: "bridge:chunk", id: JOB, text: "hello", provider: "evil", extra: 1 }, context());
  assert.deepEqual(accepted, { type: "bridge:chunk", id: JOB, text: "hello" });
});

test("refuses messages from another extension, another tab, or an unknown job", () => {
  const message = { type: "bridge:chunk", id: JOB, text: "x" };
  assert.equal(acceptSiteMessage(message, context({ senderId: "someotherextensionidxxxxxxxxxxxxxx" })), null);
  assert.equal(acceptSiteMessage(message, context({ senderId: undefined })), null);
  assert.equal(acceptSiteMessage(message, context({ senderTabId: 8 })), null);
  assert.equal(acceptSiteMessage(message, context({ senderTabId: undefined })), null);
  assert.equal(acceptSiteMessage({ ...message, id: "not-a-job" }, context()), null);
});

test("refuses unknown types, non-string ids and wrong field types", () => {
  assert.equal(acceptSiteMessage({ type: "bridge:run", id: JOB }, context()), null);
  assert.equal(acceptSiteMessage({ type: "bridge:status", id: JOB }, context()), null);
  assert.equal(acceptSiteMessage({ type: "bridge:chunk", id: 5, text: "x" }, context()), null);
  assert.equal(acceptSiteMessage({ type: "bridge:chunk", id: JOB, text: 42 }, context()), null);
  assert.equal(acceptSiteMessage({ type: "bridge:complete", id: JOB, text: { a: 1 } }, context()), null);
  assert.equal(acceptSiteMessage(null, context()), null);
  assert.equal(acceptSiteMessage("bridge:chunk", context()), null);
});

test("refuses oversized text and truncates long error messages", () => {
  const oversized = "a".repeat(MAX_SITE_TEXT_CHARS + 1);
  assert.equal(acceptSiteMessage({ type: "bridge:chunk", id: JOB, text: oversized }, context()), null);
  const error = acceptSiteMessage({ type: "bridge:error", id: JOB, message: "x".repeat(10_000) }, context());
  assert.equal(error.message.length, 500);
});

test("complete may omit text; error gets a fixed fallback when the message is missing", () => {
  assert.deepEqual(acceptSiteMessage({ type: "bridge:complete", id: JOB }, context()), { type: "bridge:complete", id: JOB });
  assert.deepEqual(acceptSiteMessage({ type: "bridge:error", id: JOB }, context()), {
    type: "bridge:error",
    id: JOB,
    message: "The web chat page reported an unknown error.",
  });
});
