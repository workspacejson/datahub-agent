import { describe, expect, it } from "vitest";
import { McpClient } from "../../src/integration/mcp-transport.js";

/**
 * A stand-in MCP server, as a real child process.
 *
 * The framing is the thing under test, so a mocked stream would test the mock.
 * These servers speak the same newline-delimited JSON-RPC over the same pipes a
 * real one does.
 */
function server(body: string) {
  return { command: process.execPath, args: ["-e", body] };
}

/** Answers `initialize` and then whatever the test needs. */
const RESPOND = `
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    handle(msg);
  }
});
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\\n"); }
`;

describe("MCP stdio client", () => {
  it("completes the handshake and reports the server's identity", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub", version: "9.9.9" } });
        reply(m.id, {});
      }`),
    );
    const info = await client.start();
    expect(info).toEqual({ serverName: "stub", serverVersion: "9.9.9" });
    await client.stop();
  });

  it("refuses a server that negotiated a different protocol revision", async () => {
    // The session would otherwise proceed with each end interpreting the other's
    // frames under different rules, and every resulting failure would present as
    // a fact about the catalog — a tool returning nothing, a field missing, a
    // shape the reader refuses — rather than as a protocol mismatch.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2025-06-18", serverInfo: { name: "newer" } });
        reply(m.id, { tools: [] });
      }`),
    );
    await expect(client.start()).rejects.toThrow(/negotiation failed.*2024-11-05.*2025-06-18/s);
    await client.stop();
  });

  it("refuses a server that answered with no protocol revision at all", async () => {
    // Silence is not assent. A server that did not say which revision it
    // selected has agreed to nothing, and reading an absent answer as a
    // positive one is the defect this repository refuses everywhere else.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { serverInfo: { name: "silent" } });
        reply(m.id, { tools: [] });
      }`),
    );
    await expect(client.start()).rejects.toThrow(/negotiation failed.*no protocolVersion/s);
    await client.stop();
  });

  it("does not declare the session open when negotiation failed", async () => {
    // `notifications/initialized` is the client declaring the session open.
    // Sending it and then objecting would announce agreement to a revision the
    // client had already determined it does not speak. The stub records every
    // method it saw and reports it on exit.
    const client = new McpClient(
      server(`
      let buf = "";
      const seen = [];
      process.on("exit", () => process.stderr.write("SAW:" + seen.join(",") + "\\n"));
      process.stdin.on("data", (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf("\\n")) !== -1) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          seen.push(m.method);
          if (m.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "1999-01-01", serverInfo: { name: "ancient" } } }) + "\\n");
          }
        }
      });`),
    );
    await expect(client.start()).rejects.toThrow(/negotiation failed/);
    await client.stop();
    expect(client.stderr).toContain("SAW:initialize");
    expect(client.stderr).not.toContain("notifications/initialized");
  });

  it("sends the initialized notification before any other request", async () => {
    // The stub records the order it received methods in, inside the single
    // parse loop, and hands that order back as the tools/list answer.
    //
    // An earlier version of this test tracked the notification from a second
    // `data` listener and asserted the server refused an early request. That
    // was racy rather than strict: the notification and the next request can
    // arrive in one chunk, and the parse listener — registered first — then
    // handled both before the watcher ran. It failed on ordering the client had
    // in fact got right. Reading the order from the stream itself cannot race
    // with the stream.
    const client = new McpClient(
      server(`
      let buf = "";
      const order = [];
      process.stdin.on("data", (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf("\\n")) !== -1) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          order.push(m.method);
          if (m.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "ordered" } } }) + "\\n");
          } else if (m.id !== undefined) {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: order.map((name) => ({ name })) } }) + "\\n");
          }
        }
      });`),
    );
    await client.start();
    const observed = (await client.listTools()).map((tool) => tool.name);
    expect(observed).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    await client.stop();
  });

  it("reassembles a response split across chunk boundaries", async () => {
    // One frame, written a few bytes at a time. A client that parsed per chunk
    // would see three unparseable fragments instead of one message.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "slow" } });
        const frame = JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "get_lineage" }] } }) + "\\n";
        let at = 0;
        const tick = setInterval(() => {
          process.stdout.write(frame.slice(at, at + 7));
          at += 7;
          if (at >= frame.length) clearInterval(tick);
        }, 2);
      }`),
    );
    await client.start();
    await expect(client.listTools()).resolves.toEqual([{ name: "get_lineage" }]);
    await client.stop();
  });

  it("matches responses to requests by id when they arrive out of order", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      const held = [];
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "reorder" } });
        held.push(m);
        if (held.length < 2) return;
        // Answer the second request first.
        for (const q of held.reverse()) {
          reply(q.id, { content: [{ type: "text", text: JSON.stringify({ urn: q.params.arguments.urn }) }] });
        }
      }`),
    );
    await client.start();
    const [first, second] = await Promise.all([
      client.callTool("get_entities", { urn: "urn:first" }),
      client.callTool("get_entities", { urn: "urn:second" }),
    ]);
    expect(first).toMatchObject({ ok: true, value: { urn: "urn:first" } });
    expect(second).toMatchObject({ ok: true, value: { urn: "urn:second" } });
    await client.stop();
  });

  it("decodes a tool's JSON text content", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub" } });
        reply(m.id, { content: [{ type: "text", text: JSON.stringify({ totalFields: 7 }) }] });
      }`),
    );
    await client.start();
    await expect(client.callTool("list_schema_fields", { urn: "urn:x" })).resolves.toEqual({
      ok: true,
      value: { totalFields: 7 },
      error: null,
    });
    await client.stop();
  });

  it("reports a tool that set isError as a failure, not as its text", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub" } });
        reply(m.id, { isError: true, content: [{ type: "text", text: "Entity not found" }] });
      }`),
    );
    await client.start();
    const result = await client.callTool("get_entities", { urns: ["urn:missing"] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Entity not found");
    await client.stop();
  });

  it("reports an empty envelope as a failure rather than as an empty answer", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub" } });
        reply(m.id, { content: [] });
      }`),
    );
    await client.start();
    const result = await client.callTool("get_lineage", { urn: "urn:x" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no text content");
    await client.stop();
  });

  it("hands back plain text as a value instead of failing on it", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub" } });
        reply(m.id, { content: [{ type: "text", text: "not json, but a real answer" }] });
      }`),
    );
    await client.start();
    await expect(client.callTool("search", {})).resolves.toEqual({
      ok: true,
      value: "not json, but a real answer",
      error: null,
    });
    await client.stop();
  });

  it("surfaces a JSON-RPC error as a failed call", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "stub" } });
        fail(m.id, -32601, "Unknown tool: get_lineage");
      }`),
    );
    await client.start();
    const result = await client.callTool("get_lineage", { urn: "urn:x" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown tool");
    await client.stop();
  });

  it("fails a pending call with the exit cause when the server dies mid-request", async () => {
    // The failure this refuses: a dead server producing a request that hangs to
    // its timeout and reports a bound rather than a crash.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "doomed" } });
        process.stderr.write("fatal: cannot reach DataHub\\n");
        process.exit(3);
      }`),
      { requestTimeoutMs: 30_000 },
    );
    await client.start();
    const result = await client.callTool("get_entities", { urns: ["urn:x"] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited");
    expect(client.stderr).toContain("cannot reach DataHub");
    await client.stop();
  });

  it("fails to start when the server command does not exist", async () => {
    const client = new McpClient({ command: "definitely-not-a-real-binary-xyzzy", args: [] });
    await expect(client.start()).rejects.toThrow(/could not start|exited/);
    await client.stop();
  });

  it("bounds a request the server never answers", async () => {
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "mute" } });
        // Deliberately no reply.
      }`),
      { requestTimeoutMs: 150 },
    );
    await client.start();
    const result = await client.callTool("get_lineage", { urn: "urn:x" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    await client.stop();
  });
});
