import assert from "node:assert/strict";
import test from "node:test";
import {
  ToolProtocolError,
  assertOfferedTools,
  createCallNonce,
  describeToolProtocol,
  makeAssistantMessage,
  normalizeToolArguments,
  parseToolReply,
  toolNamesFromTools,
  validateToolTranscript,
} from "../tool-calls.mjs";

const NONCE = "nonce-abc_123";
const block = (body, nonce = NONCE) => `<<AIB:CALL:${nonce}>>\n${body}\n<<AIB:END:${nonce}>>`;

const bashTools = [
  {
    type: "function",
    function: {
      name: "Bash",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", minLength: 1 },
          description: { type: "string" },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

const multiTools = [
  ...bashTools,
  { type: "function", function: { name: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
];

test("parses OpenAI and legacy tool request schemas for offered names", () => {
  assert.deepEqual(toolNamesFromTools(bashTools), ["Bash"]);
  assert.deepEqual(toolNamesFromTools([{ name: "Write", parameters: { type: "object" } }]), ["Write"]);
  assert.deepEqual(toolNamesFromTools(null), []);
});

test("accepts exactly one whole-reply block that matches an offered tool", () => {
  assert.deepEqual(
    parseToolReply(block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls -la\"}}"), { nonce: NONCE, tools: bashTools }),
    { name: "Bash", arguments: { command: "ls -la" } },
  );
});

test("treats bare, fenced and prose-wrapped JSON as plain text, never as a tool call", () => {
  const bare = "{\"name\":\"Bash\",\"arguments\":{\"command\":\"rm -rf /\"}}";
  const fenced = "```json\n{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}\n```";
  const prose = "Let me check.\n{\"name\":\"Bash\",\"arguments\":{\"command\":\"pwd\"}}\nDone.";
  for (const reply of [bare, fenced, prose]) {
    assert.equal(parseToolReply(reply, { nonce: NONCE, tools: bashTools }), null);
    assert.deepEqual(makeAssistantMessage(reply, { tools: bashTools, nonce: NONCE }), { role: "assistant", content: reply });
  }
});

test("rejects a quoted block that is not the whole reply", () => {
  const quoted = `The IDE sent this earlier: ${block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}")} as an example.`;
  assert.throws(() => parseToolReply(quoted, { nonce: NONCE, tools: bashTools }), ToolProtocolError);
});

test("rejects two blocks, a stray marker, and blocks carrying a different nonce", () => {
  const one = block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}");
  assert.throws(() => parseToolReply(`${one}\n${one}`, { nonce: NONCE, tools: bashTools }), ToolProtocolError);
  assert.throws(() => parseToolReply(`${one}\n<<AIB:CALL:x>>`, { nonce: NONCE, tools: bashTools }), ToolProtocolError);
  const replayed = block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}", "some-other-nonce");
  assert.throws(() => parseToolReply(replayed, { nonce: NONCE, tools: bashTools }), ToolProtocolError);
});

test("rejects names that were not offered, including case-only variants", () => {
  assert.throws(() => parseToolReply(block("{\"name\":\"Delete\",\"arguments\":{}}"), { nonce: NONCE, tools: bashTools }), /not offered/);
  assert.throws(() => parseToolReply(block("{\"name\":\"bash\",\"arguments\":{\"command\":\"ls\"}}"), { nonce: NONCE, tools: bashTools }), /not offered/);
});

test("rejects arguments that violate the offered JSON schema", () => {
  const cases = [
    ["{\"name\":\"Bash\",\"arguments\":{}}", /is required/],
    ["{\"name\":\"Bash\",\"arguments\":{\"command\":42}}", /must be string/],
    ["{\"name\":\"Bash\",\"arguments\":{\"command\":\"\"}}", /shorter than 1/],
    ["{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\",\"sudo\":true}}", /not an allowed argument/],
    ["{\"name\":\"Bash\",\"arguments\":\"ls\"}", /must be a JSON object/],
  ];
  for (const [body, pattern] of cases) {
    assert.throws(() => parseToolReply(block(body), { nonce: NONCE, tools: bashTools }), (error) => error instanceof ToolProtocolError && pattern.test(error.message), body);
  }
});

test("rejects malformed blocks and unexpected fields", () => {
  assert.throws(() => parseToolReply(block("{\"name\":\"Bash\""), { nonce: NONCE, tools: bashTools }), /not valid JSON/);
  assert.throws(() => parseToolReply(block("[]"), { nonce: NONCE, tools: bashTools }), /JSON object/);
  assert.throws(() => parseToolReply(block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"},\"extra\":1}"), { nonce: NONCE, tools: bashTools }), /unexpected field/);
});

test("enforces enum, array items and nested objects in the schema", () => {
  const tools = [{
    name: "Edit",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["replace", "insert"] },
        lines: { type: "array", items: { type: "integer", minimum: 1 } },
        target: { type: "object", properties: { path: { type: "string", pattern: "^[a-z][a-z./-]*$" } }, required: ["path"] },
      },
      required: ["mode"],
    },
  }];
  const good = "{\"name\":\"Edit\",\"arguments\":{\"mode\":\"insert\",\"lines\":[1,2],\"target\":{\"path\":\"src/a.js\"}}}";
  assert.equal(parseToolReply(block(good), { nonce: NONCE, tools }).arguments.mode, "insert");
  assert.throws(() => parseToolReply(block("{\"name\":\"Edit\",\"arguments\":{\"mode\":\"delete\"}}"), { nonce: NONCE, tools }), /allowed values/);
  assert.throws(() => parseToolReply(block("{\"name\":\"Edit\",\"arguments\":{\"mode\":\"insert\",\"lines\":[0]}}"), { nonce: NONCE, tools }), /below 1/);
  assert.throws(() => parseToolReply(block("{\"name\":\"Edit\",\"arguments\":{\"mode\":\"insert\",\"target\":{\"path\":\"../etc\"}}}"), { nonce: NONCE, tools }), /pattern/);
});

test("refuses tool schemas that use keywords the gateway cannot enforce", () => {
  assert.throws(() => assertOfferedTools([{ name: "X", parameters: { type: "object", oneOf: [{}] } }]), /not supported/);
  assert.throws(() => assertOfferedTools([{ name: "X", parameters: { type: "object", properties: { a: { $ref: "#/defs/a" } } } }]), /not supported/);
  assert.throws(() => assertOfferedTools([{ name: "Bad Name", parameters: { type: "object" } }]), /name of/);
  assert.throws(() => assertOfferedTools([{ name: "Dup", parameters: {} }, { name: "Dup", parameters: {} }]), /more than once/);
});

test("tool-protocol instructions carry the nonce and the exact block format", () => {
  const text = describeToolProtocol(bashTools, NONCE);
  assert.match(text, /<<AIB:CALL:nonce-abc_123>>/);
  assert.match(text, /<<AIB:END:nonce-abc_123>>/);
  assert.match(text, /"name":"Bash"/);
});

test("makes OpenAI tool_calls with stringified arguments and requires a nonce when tools are offered", () => {
  const message = makeAssistantMessage(block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls -la\"}}"), { tools: bashTools, nonce: NONCE });
  assert.equal(message.content, null);
  assert.equal(message.tool_calls[0].type, "function");
  assert.equal(message.tool_calls[0].function.name, "Bash");
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { command: "ls -la" });
  assert.match(message.tool_calls[0].id, /^call_/);
  assert.throws(() => makeAssistantMessage(block("{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}"), { tools: bashTools, nonce: null }), ToolProtocolError);
});

test("validates tool-result pairing across the transcript", () => {
  const paired = [
    { role: "user", content: "list" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "a.txt" },
  ];
  assert.doesNotThrow(() => validateToolTranscript(paired));
  assert.throws(() => validateToolTranscript([{ role: "tool", tool_call_id: "call_9", content: "x" }]), /does not match/);
  assert.throws(() => validateToolTranscript([
    { role: "assistant", tool_calls: [{ id: "call_1" }] },
    { role: "assistant", tool_calls: [{ id: "call_1" }] },
  ]), /repeated/);
});

test("creates a fresh nonce for each request", () => {
  const first = createCallNonce();
  assert.match(first, /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first, createCallNonce());
});

test("normalizes object and pre-stringified arguments", () => {
  assert.equal(normalizeToolArguments({ command: "ls" }), "{\"command\":\"ls\"}");
  assert.equal(normalizeToolArguments("{\"command\":\"ls\"}"), "{\"command\":\"ls\"}");
  assert.equal(normalizeToolArguments(null), "{}");
  assert.equal(normalizeToolArguments("not-json"), "{\"value\":\"not-json\"}");
});
