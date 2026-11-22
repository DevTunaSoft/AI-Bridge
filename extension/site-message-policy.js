// Decides whether a message from a content script may be forwarded to the local server.
// Kept free of chrome.* APIs so it can be unit-tested in Node.
//
// A message is accepted only when:
//   - it came from this extension (senderId equals runtimeId),
//   - its type is one the content script is expected to send,
//   - its job id was dispatched to the same tab that sent it (so other tabs cannot inject text), and
//   - its fields are the expected types and within size limits.
// Only the validated fields are forwarded; anything else in the message is dropped.

export const SITE_MESSAGE_TYPES = Object.freeze(new Set(["bridge:chunk", "bridge:complete", "bridge:error"]));
export const MAX_SITE_TEXT_CHARS = 2_000_000;
const MAX_ERROR_CHARS = 500;

export function acceptSiteMessage(message, { senderId, runtimeId, senderTabId, jobTabs }) {
  if (!runtimeId || senderId !== runtimeId) return null;
  if (!isPlainObject(message) || !SITE_MESSAGE_TYPES.has(message.type)) return null;
  if (typeof message.id !== "string" || message.id === "") return null;
  if (senderTabId === undefined || jobTabs.get(message.id) !== senderTabId) return null;

  if (message.type === "bridge:chunk") {
    if (!isBoundedString(message.text)) return null;
    return { type: message.type, id: message.id, text: message.text };
  }
  if (message.type === "bridge:complete") {
    if (message.text !== undefined && !isBoundedString(message.text)) return null;
    return message.text === undefined
      ? { type: message.type, id: message.id }
      : { type: message.type, id: message.id, text: message.text };
  }
  const reason = typeof message.message === "string" ? message.message.slice(0, MAX_ERROR_CHARS) : "The web chat page reported an unknown error.";
  return { type: message.type, id: message.id, message: reason };
}

function isBoundedString(value) {
  return typeof value === "string" && value.length <= MAX_SITE_TEXT_CHARS;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
