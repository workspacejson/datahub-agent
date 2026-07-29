import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { McpClient, MCP_PROTOCOL_VERSION } from "../../src/integration/mcp-transport.js";

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

  it("explains a crash with the most recent stderr, not with three lines of startup chatter", async () => {
    // The head-only buffer reported `slice(-3)` of the retained head. Against a
    // server that logs more than the buffer holds, those are three arbitrary
    // startup lines presented as the cause of death — while the traceback, which
    // arrives at the end, was discarded entirely.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "chatty" } });
        for (let i = 0; i < 250; i++) process.stderr.write("INFO startup line " + i + "\\n");
        // Exit from the flush callback. See the note on the long-stream test below.
        process.stderr.write("Traceback: the actual cause\\n", () => process.exit(7));
      }`),
    );
    await client.start();
    const result = await client.callTool("get_entities", { urns: ["urn:x"] });
    expect(result.ok).toBe(false);
    // The cause, which the head-only buffer discarded entirely.
    expect(result.error).toContain("Traceback: the actual cause");
    // And not the early lines the old `slice(-3)`-of-the-head reported instead.
    // The two lines immediately before the traceback are legitimately included —
    // they are the recent tail. Lines from the start of the run are not.
    expect(result.error).not.toMatch(/INFO startup line [0-9]\b/);
    expect(result.error).not.toMatch(/INFO startup line 19[0-9]\b/);
    await client.stop();
  });

  it("retains both ends of a long stderr stream and says how much it dropped", async () => {
    // The fixture exits from the flush callback rather than on the line after the
    // write, because `process.exit` does not flush what is still sitting in the
    // stream's own buffer. Node's stdio to a pipe is asynchronous on POSIX, so
    // this is true regardless of how much room the kernel pipe has — the 4395
    // bytes written here fit inside a 65536-byte pipe several times over and were
    // still lost. On a CI runner the child stopped emitting at "line 453" of 501,
    // and the sibling test above lost its traceback after "line 172" of 251.
    //
    // Establishing that cost an intervention on the wrong end: draining stderr in
    // the parent before composing the diagnostic changed nothing here, which is
    // what rules the parent in as innocent for *this* failure. That drain is a
    // real fix for a real defect (HAC-258) and it is not this one.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "chatty" } });
        for (let i = 0; i < 500; i++) process.stderr.write("line " + i + "\\n");
        process.stderr.write("LAST\\n", () => process.exit(1));
      }`),
    );
    await client.start();
    await client.callTool("get_entities", { urns: ["urn:x"] });
    expect(client.stderr).toContain("line 0");
    expect(client.stderr).toContain("LAST");
    expect(client.stderr).toMatch(/line\(s\) omitted/);
    await client.stop();
  });

  it("does not throw when the server dies before the initialized notification lands", async () => {
    // `#notify` wrote to stdin with no callback and the stream had no `error`
    // listener, so an EPIPE in this window was an uncaught exception that took
    // the whole process down instead of failing the run with a cause.
    const client = new McpClient(
      server(`${RESPOND}
      function handle(m) {
        if (m.method !== "initialize") return;
        reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "vanishing" } });
        // Answer, then leave immediately — the notification arrives at a closed pipe.
        setTimeout(() => process.exit(0), 5);
      }`),
      { requestTimeoutMs: 2_000 },
    );
    await expect(client.start()).resolves.toMatchObject({ serverName: "vanishing" });
    const result = await client.callTool("get_entities", { urns: ["urn:x"] });
    expect(result.ok).toBe(false);
    await client.stop();
  });

  it("removes its exit handler on stop, so repeated clients do not accumulate them", async () => {
    const before = process.listenerCount("exit");
    for (let i = 0; i < 3; i += 1) {
      const client = new McpClient(
        server(`${RESPOND}
        function handle(m) {
          if (m.method === "initialize") return reply(m.id, { protocolVersion: "2024-11-05", serverInfo: { name: "s" } });
          reply(m.id, {});
        }`),
      );
      await client.start();
      await client.stop();
    }
    expect(process.listenerCount("exit")).toBe(before);
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

/**
 * A child process the test drives directly, so the exit ordering is asserted
 * rather than raced.
 *
 * The defect these cover was found as a CI failure and did not reproduce on the
 * author's machine at all — it is a function of when the runner schedules the
 * parent, not of anything a test can ask for. Reproducing it with a real child
 * would make the regression test a coin flip: green on a quiet machine whether
 * or not the bug is present, which is the same "passes for the wrong reason"
 * this repository refuses from its evidence. Driving the events directly asserts
 * the contract instead — `data` that arrives after `exit` belongs in the
 * diagnostic — and that is deterministic on every machine.
 */
function injectedChild() {
  const stdout = new PassThrough({ encoding: "utf8" });
  const stderr = new PassThrough({ encoding: "utf8" });
  const stdin = new Writable({
    write(chunk, _encoding, done) {
      // Answer `initialize` as a real server would, so `start()` completes and
      // the test reaches the exit path it is actually about.
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; method?: string };
        if (message.method === "initialize" && message.id !== undefined) {
          stdout.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: "injected" } },
            })}\n`,
          );
        }
      }
      done();
    },
  });

  const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 4242, kill: () => true });
  return { child: child as unknown as ChildProcessWithoutNullStreams, stderr };
}

describe("MCP stdio client, when the server dies", () => {
  /** Start a client against an injected child, with a call already in flight. */
  async function inFlight(stderrDrainMs: number) {
    const { child, stderr } = injectedChild();
    const client = new McpClient(
      { command: "injected", args: [] },
      { spawnProcess: () => child, stderrDrainMs },
    );
    await client.start();
    const call = client.callTool("get_entities", { urns: ["urn:x"] });
    return { child, stderr, client, call };
  }

  it("explains the death with stderr that arrived after the exit event", async () => {
    const { child, stderr, client, call } = await inFlight(250);

    // The ordering CI hit: the process is reaped, and the line that explains why
    // is still queued behind the exit event. Composing on `exit` reported the
    // death without its cause.
    child.emit("exit", 7, null);
    stderr.write("Traceback: the actual cause\n");
    stderr.end();

    const result = await call;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Traceback: the actual cause");
    // The stream ended, so the tail is whole and nothing is caveated.
    expect(result.error).not.toContain("stderr tail incomplete");

    const stopped = client.stop();
    child.emit("exit", 7, null);
    await stopped;
  });

  it("marks the diagnostic incomplete when the stream never ended", async () => {
    const { child, stderr, client, call } = await inFlight(50);

    child.emit("exit", 7, null);
    stderr.write("Traceback: the actual cause\n");
    // No `end()`. This is the `npx`/`uvx` shape: a grandchild holds the write end
    // of the pipe open, EOF never arrives, and the budget is what expires. The
    // caveat is the whole point — a crash reason that dropped the rest of the
    // tail in silence would be absence rendered as completeness.

    const result = await call;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Traceback: the actual cause");
    expect(result.error).toContain("stderr tail incomplete");

    const stopped = client.stop();
    child.emit("exit", 7, null);
    await stopped;
  });
});
