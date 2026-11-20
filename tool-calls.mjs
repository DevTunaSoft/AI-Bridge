/**
 * Strict tool-call protocol for chat tabs that cannot constrain their output.
 *
 * A reply is a tool call only when the WHOLE reply is one block wrapped in markers that carry a
 * per-request nonce, the named tool is exactly one the IDE offered, and the arguments validate
 * against that tool's JSON schema. Bare JSON, fenced JSON, prose-wrapped JSON and quoted examples
 * are plain text, never tool calls. A reply that uses the markers but does not satisfy every rule
 * is rejected (ToolProtocolError) so the caller can fail closed.
 *
 * The gateway never executes tools. OpenCode enforces its own permissions for every action.
 */

import crypto from "node:crypto";

export class ToolProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolProtocolError";
  }
}

const MAX_OFFERED_TOOLS = 64;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SUPPORTED_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "minLength", "maxLength", "minimum", "maximum", "pattern",
  "description", "title", "default", "$schema",
]);
const MARKER_PREFIX = "<<AIB:";

export function toolNamesFromTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (typeof tool?.function?.name === "string") return tool.function.name;
      if (typeof tool?.name === "string") return tool.name;
      return null;
    })
    .filter(Boolean);
}

// Validates the offered tools for one request and returns them in normalised form.
// Anything outside the supported schema subset is refused, so no rule is silently skipped.
export function assertOfferedTools(tools) {
  if (!Array.isArray(tools)) throw new ToolProtocolError("tools must be an array");
  if (tools.length > MAX_OFFERED_TOOLS) throw new ToolProtocolError(`at most ${MAX_OFFERED_TOOLS} tools may be offered`);
  const seen = new Set();
  return tools.map((tool) => {
    const source = isPlainObject(tool?.function) ? tool.function : tool;
    if (!isPlainObject(source) || typeof source.name !== "string" || !TOOL_NAME_PATTERN.test(source.name)) {
      throw new ToolProtocolError("every tool needs a name of 1-64 letters, digits, '_', '.' or '-'");
    }
    if (seen.has(source.name)) throw new ToolProtocolError(`tool "${source.name}" is offered more than once`);
    seen.add(source.name);
    const parameters = source.parameters ?? { type: "object", properties: {} };
    assertSupportedSchema(parameters, source.name);
    return { name: source.name, parameters };
  });
}

// Fresh per request: a block copied from an earlier reply, source file or log cannot match.
export function createCallNonce() {
  return crypto.randomBytes(12).toString("base64url");
}

export function describeToolProtocol(tools, nonce) {
  const offered = assertOfferedTools(tools).map(({ name, parameters }) => ({ type: "function", function: { name, parameters } }));
  return [
    `TOOL CALLING. The IDE offers these tools (JSON schema): ${JSON.stringify(offered)}`,
    "To call exactly one tool, reply with ONLY this block, with nothing before or after it:",
    `<<AIB:CALL:${nonce}>>`,
    "{\"name\":\"<exact tool name>\",\"arguments\":{...arguments matching the schema...}}",
    `<<AIB:END:${nonce}>>`,
    "If no tool is needed, answer normally and do not use that block.",
  ].join("\n");
}

// Returns null when the reply contains no protocol markers (plain text). Returns the call when the
// reply is exactly one valid block. Throws ToolProtocolError for any other use of the markers.
export function parseToolReply(text, { nonce, tools }) {
  const reply = typeof text === "string" ? text.trim() : "";
  const markerCount = reply.split(MARKER_PREFIX).length - 1;
  if (markerCount === 0) return null;
  if (!nonce) throw new ToolProtocolError("no request nonce is available for tool calls");
  if (markerCount !== 2) throw new ToolProtocolError("the reply contains a stray or repeated tool marker");

  const open = `<<AIB:CALL:${nonce}>>`;
  const close = `<<AIB:END:${nonce}>>`;
  if (!reply.startsWith(open) || !reply.endsWith(close)) {
    throw new ToolProtocolError("the tool block is not the whole reply, or its markers do not belong to this request");
  }

  let call;
  try {
    call = JSON.parse(reply.slice(open.length, reply.length - close.length).trim());
  } catch {
    throw new ToolProtocolError("the tool block is not valid JSON");
  }
  if (!isPlainObject(call)) throw new ToolProtocolError("the tool block must be a JSON object");
  const unexpected = Object.keys(call).find((key) => key !== "name" && key !== "arguments");
  if (unexpected !== undefined) throw new ToolProtocolError(`unexpected field "${unexpected}" in the tool block`);
  if (typeof call.name !== "string") throw new ToolProtocolError("the tool block needs a string name");

  const tool = assertOfferedTools(tools).find((item) => item.name === call.name);
  if (!tool) throw new ToolProtocolError(`tool "${call.name}" was not offered`);

  const args = call.arguments === undefined ? {} : call.arguments;
  if (!isPlainObject(args)) throw new ToolProtocolError("arguments must be a JSON object");
  validateAgainstSchema(args, tool.parameters, "arguments");
  return { name: tool.name, arguments: args };
}

// Rejects transcripts whose tool results do not pair with an earlier, unique tool call.
export function validateToolTranscript(messages) {
  const issued = new Set();
  for (const message of messages) {
    if (Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        if (typeof call?.id !== "string" || !call.id) throw new ToolProtocolError("every tool call in the transcript needs an id");
        if (issued.has(call.id)) throw new ToolProtocolError(`tool call id "${call.id}" is repeated`);
        issued.add(call.id);
      }
    }
    if (message?.role === "tool" && (typeof message.tool_call_id !== "string" || !issued.has(message.tool_call_id))) {
      throw new ToolProtocolError("a tool result does not match an earlier tool call");
    }
  }
}

// Returns a plain assistant message, or an OpenAI tool_calls message for a valid protocol block.
export function makeAssistantMessage(text, { tools = [], nonce = null } = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { role: "assistant", content: text };
  const call = parseToolReply(text, { nonce, tools });
  if (!call) return { role: "assistant", content: text };
  return {
    role: "assistant",
    content: null,
    tool_calls: [{
      id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }],
  };
}

export function normalizeToolArguments(args) {
  if (args === undefined || args === null) return "{}";
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) return "{}";
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify({ value: args });
    }
  }
  if (typeof args === "object") return JSON.stringify(args);
  return JSON.stringify({});
}

function assertSupportedSchema(schema, where) {
  if (!isPlainObject(schema)) throw new ToolProtocolError(`schema at ${where} must be an object`);
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) throw new ToolProtocolError(`schema keyword "${key}" at ${where} is not supported`);
  }
  if (schema.type !== undefined && (typeof schema.type !== "string" || !SUPPORTED_TYPES.has(schema.type))) {
    throw new ToolProtocolError(`schema type at ${where} must be one supported type`);
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) throw new ToolProtocolError(`enum at ${where} must be an array`);
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((key) => typeof key === "string"))) {
    throw new ToolProtocolError(`required at ${where} must be a list of names`);
  }
  if (schema.pattern !== undefined) {
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      throw new ToolProtocolError(`pattern at ${where} is not a valid regular expression`);
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) throw new ToolProtocolError(`properties at ${where} must be an object`);
    for (const [key, child] of Object.entries(schema.properties)) assertSupportedSchema(child, `${where}.${key}`);
  }
  if (schema.items !== undefined) assertSupportedSchema(schema.items, `${where}[]`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    assertSupportedSchema(schema.additionalProperties, `${where}.*`);
  }
}

function validateAgainstSchema(value, schema, where) {
  if (schema.enum !== undefined && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    throw new ToolProtocolError(`${where} is not one of the allowed values`);
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    throw new ToolProtocolError(`${where} must be ${schema.type}`);
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) throw new ToolProtocolError(`${where} is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) throw new ToolProtocolError(`${where} is longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) throw new ToolProtocolError(`${where} does not match its pattern`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new ToolProtocolError(`${where} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new ToolProtocolError(`${where} is above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${where}[${index}]`));
  }
  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new ToolProtocolError(`${where}.${key} is required`);
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateAgainstSchema(item, properties[key], `${where}.${key}`);
      } else if (schema.additionalProperties === false) {
        throw new ToolProtocolError(`${where}.${key} is not an allowed argument`);
      } else if (isPlainObject(schema.additionalProperties)) {
        validateAgainstSchema(item, schema.additionalProperties, `${where}.${key}`);
      }
    }
  }
}

function matchesType(value, type) {
  switch (type) {
    case "object": return isPlainObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
