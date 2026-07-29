/**
 * A minimal MCP client over stdio, sufficient to call the official DataHub MCP
 * server and nothing more.
 *
 * Why this exists at all, given the read path already worked:
 *
 * The emitter used to reach DataHub's GraphQL API directly and restrict itself
 * to the fields the official MCP server projects. That restriction was real,
 * measured field by field, and honestly documented — and it still was not MCP.
 * "We ask for the same fields the MCP server would" is a claim about a request
 * body; "we read through the official MCP server" is a claim about transport.
 * The repository asserted the second and implemented the first, and no amount of
 * fidelity in the first makes the second true.
 *
 * The distinction has teeth. A projection restriction is enforced by whoever is
 * maintaining the query string; the moment someone adds a field, the restriction
 * is gone and nothing fails. Reading through the server makes the boundary
 * structural: a field the projection drops is not available to ask for, because
 * the process on the other end of the pipe never sends it.
 *
 * Why hand-rolled rather than the MCP SDK:
 *
 * The stdio transport is newline-delimited JSON-RPC 2.0, and this client needs
 * three methods of it. A dependency would buy protocol coverage this does not
 * use, in exchange for a package the clean-room audit has to vouch for. The
 * framing is implemented here in full and is the whole of the protocol surface
 * this project depends on.
 *
 * What this deliberately does not do: sampling, roots, resources, prompts,
 * progress notifications, or server-initiated requests. Incoming messages that
 * are none of this client's business are dropped rather than queued, because a
 * client that silently accumulates unread frames is a leak wearing a feature's
 * clothes.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable } from "node:stream";

/** The protocol revision this client speaks. Sent in the handshake and checked. */
export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

/** Retained stderr, from both ends of the stream. See `#retainStderr`. */
const HEAD_LINES = 100;
const TAIL_LINES = 100;

/**
 * How long the exit path keeps draining stderr before composing a diagnostic.
 *
 * See `#composeExitReason` for why this is spent on nearly every failure rather
 * than only on unusual ones, and what the cost buys.
 */
const STDERR_DRAIN_MS = 250;

/**
 * How a child process is created.
 *
 * Injected only so the exit path can be tested against streams the test drives.
 * Reproducing the real ordering depends on machine load — it reproduced on a CI
 * runner and not on the author's laptop — so a test that raced it would be a
 * coin flip that passes for the wrong reason. See `#composeExitReason`.
 *
 * Narrower than `typeof spawn` on purpose: the seam describes the one call this
 * client makes, not the whole overload set, so a substitute has one shape to
 * satisfy rather than eight. Piping all three streams is this client's
 * requirement, not the caller's choice, so it stays in `spawnPiped`.
 */
export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

/** The real one. All three streams piped, because the client reads all three. */
const spawnPiped: SpawnProcess = (command, args, options) =>
  spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"], env: options.env });

export interface McpServerCommand {
  command: string;
  args: readonly string[];
  /** Merged over the parent environment, not a replacement for it. */
  env?: Record<string, string>;
}

export interface McpClientOptions {
  /** Ceiling for any single request. A server that never answers must not hang a run. */
  requestTimeoutMs?: number;
  /** Where the server's stderr goes. Captured by default so a crash is legible. */
  onStderr?: (line: string) => void;
  /** How long the exit path drains stderr before composing. See `#composeExitReason`. */
  stderrDrainMs?: number;
  /** Test seam for the exit path. See `SpawnProcess`. */
  spawnProcess?: SpawnProcess;
}

/**
 * A tool call's outcome, as this client reports it.
 *
 * `ok: false` covers every way a call can fail to produce an answer — transport
 * death, protocol error, a tool that raised, a body that would not parse. They
 * are distinguished in `error`, and none of them are ever reported as an empty
 * result. That collapse is the exact defect the change-impact contract exists to
 * refuse, and it would be no better for arriving over a pipe.
 */
export type McpToolResult =
  | { ok: true; value: unknown; error: null }
  | { ok: false; value: null; error: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** A JSON-RPC error object, as far as this client cares about its shape. */
interface JsonRpcError {
  code?: number;
  message?: string;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
}

export class McpClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #buffer = "";
  /** The first lines the server produced. See `#retainStderr`. */
  #stderrHead: string[] = [];
  /** The most recent lines, as a ring. See `#retainStderr`. */
  #stderrTail: string[] = [];
  #stderrDropped = 0;
  #closed = false;
  /** Set when the process dies, so late callers get the cause and not a timeout. */
  #exitReason: string | null = null;
  /** Registered on `process.exit` so an unhandled throw cannot orphan the child. */
  #killOnExit: (() => void) | null = null;

  readonly #server: McpServerCommand;
  readonly #requestTimeoutMs: number;
  readonly #onStderr: ((line: string) => void) | undefined;
  readonly #stderrDrainMs: number;
  readonly #spawnProcess: SpawnProcess;

  constructor(server: McpServerCommand, options: McpClientOptions = {}) {
    this.#server = server;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.#onStderr = options.onStderr;
    this.#stderrDrainMs = options.stderrDrainMs ?? STDERR_DRAIN_MS;
    this.#spawnProcess = options.spawnProcess ?? spawnPiped;
  }

  /**
   * Retain a stderr line, keeping both ends of the stream.
   *
   * A single head-only buffer was wrong in a way that only shows up on the runs
   * that matter. The head is kept because the first failure explains the rest —
   * but a server that logs its startup and then dies a thousand lines later has
   * a traceback at the *end*, and a head-only buffer discards precisely that.
   * Meanwhile `#die` reported the last three lines *of the retained head*, which
   * with a chatty server is neither the first failure nor the crash: it is three
   * arbitrary lines from startup, presented as the cause of death.
   *
   * So both ends are kept and the gap is counted, which is the only honest thing
   * to show for a stream that was longer than the buffer.
   */
  #retainStderr(line: string): void {
    if (this.#stderrHead.length < HEAD_LINES) {
      this.#stderrHead.push(line);
      return;
    }
    this.#stderrTail.push(line);
    if (this.#stderrTail.length > TAIL_LINES) {
      this.#stderrTail.shift();
      this.#stderrDropped += 1;
    }
  }

  /** The server's stderr, retained so a failed handshake can say why. */
  get stderr(): string {
    const parts = [...this.#stderrHead];
    if (this.#stderrDropped > 0) parts.push(`… ${this.#stderrDropped} line(s) omitted …`);
    parts.push(...this.#stderrTail);
    return parts.join("\n");
  }

  /** The most recent lines, which is what a crash is explained by. */
  #recentStderr(count: number): string[] {
    const recent = this.#stderrTail.length > 0 ? this.#stderrTail : this.#stderrHead;
    return recent.slice(-count);
  }

  /**
   * Compose the death diagnostic once stderr has had a chance to arrive.
   *
   * `exit` fires when the process is reaped, which is not when its stdio is
   * drained — `data` events already queued sit ahead of us in the event loop.
   * Composing directly in the `exit` handler therefore reported whatever had
   * been retained by that instant, and a server whose traceback is its final
   * write could have that traceback missing from the one message that exists to
   * carry it. That is the failure `#retainStderr` was written to end, reappearing
   * one layer up: the buffer was right, it was read too early.
   *
   * What this waits on is worth stating precisely, because the event's name
   * misleads about the common case. `end` fires on EOF, and EOF requires *every*
   * write end of the pipe to be closed — so a server started through `npx` or
   * `uvx`, which is how the official DataHub server is started, holds stderr open
   * through its grandchildren and will never emit `end` here. The budget is the
   * normal path, not the exceptional one. It is still the right shape, because
   * the queued `data` events flush during the window and those were what went
   * missing. This drains the event queue and uses `end` as an early exit; it does
   * not await `end`.
   *
   * When the budget expires the diagnostic says so. A crash reason that quietly
   * drops the tail is absence rendered as completeness — the shape this project
   * refuses everywhere else, and indefensible in the code that renders that
   * judgement about other systems.
   */
  #composeExitReason(stderr: Readable | null, how: string): void {
    let settled = false;
    const settle = (complete: boolean): void => {
      if (settled) return;
      settled = true;
      const recent = this.#recentStderr(3);
      this.#die(
        `MCP server exited (${how})` +
          (recent.length ? `: ${recent.join(" | ")}` : "") +
          (complete ? "" : ` [stderr tail incomplete — stream did not end within ${this.#stderrDrainMs}ms]`),
      );
    };

    // Already ended means every `data` event has already been emitted.
    if (!stderr || stderr.readableEnded) {
      settle(true);
      return;
    }

    const budget = setTimeout(() => settle(false), this.#stderrDrainMs);
    // A pending drain must not be the reason a process stays alive.
    budget.unref?.();
    stderr.once("end", () => {
      clearTimeout(budget);
      settle(true);
    });
  }

  /**
   * Start the server and complete the MCP handshake.
   *
   * Throws rather than returning a status, because every subsequent call depends
   * on this having happened. A client that half-started and let callers discover
   * it one failed tool call at a time would report the same fault N times in N
   * different disguises.
   */
  async start(): Promise<{ serverName: string | null; serverVersion: string | null }> {
    if (this.#child) throw new Error("MCP client already started");

    const child = this.#spawnProcess(this.#server.command, [...this.#server.args], {
      env: { ...process.env, ...this.#server.env },
    });
    this.#child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        this.#retainStderr(line);
        this.#onStderr?.(line);
      }
    });

    // A write to a pipe whose reader has gone emits `error` on the stream, and
    // an `error` with no listener is thrown. The child's own `error` event does
    // not cover this: that one is about spawning, this one is about the pipe.
    // Without a listener here, a server crashing in the window between answering
    // `initialize` and receiving `notifications/initialized` takes the whole
    // process down with an EPIPE instead of failing the run with its cause.
    child.stdin.on("error", (error) => this.#die(`the MCP server's stdin closed: ${error.message}`));

    // A spawn that fails (missing binary) and one that exits (crash) are
    // different faults with the same consequence: every pending request must be
    // failed with the cause, not left to time out into a less informative error.
    child.on("error", (error) => this.#die(`could not start "${this.#server.command}": ${error.message}`));
    child.on("exit", (code, signal) => {
      this.#composeExitReason(child.stderr, signal ? `signal ${signal}` : `code ${code}`);
    });

    // The child outlives an unhandled throw in the parent otherwise. Closing
    // stdin on exit usually ends it, but "usually" is doing real work in that
    // sentence — a server blocked on a network call is not reading its stdin and
    // will not notice. Registered here rather than at each call site so every
    // consumer of this client gets it, and removed on `stop()` so a long-lived
    // process spawning many clients does not accumulate handlers.
    this.#killOnExit = () => child.kill("SIGKILL");
    process.once("exit", this.#killOnExit);

    const initialized = (await this.#request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
    })) as {
      protocolVersion?: unknown;
      serverInfo?: { name?: string; version?: string };
    } | null;

    // Version negotiation is a real step, not a formality, and it is checked
    // before the session is declared open.
    //
    // `initialize` is where the two ends agree which revision they are speaking.
    // The server answers with the revision it selected, and that answer is
    // allowed to differ from the one proposed — which is precisely why it has to
    // be read. This client implements exactly one revision, so anything other
    // than that revision means the session would proceed with each side
    // interpreting the other's frames under different rules. The failures that
    // produces are downstream and misleading: a tool that "returns nothing", a
    // field that is "missing", a shape the reader refuses — every one of them
    // presenting as a fact about the catalog rather than as a protocol mismatch.
    //
    // A missing `protocolVersion` fails for the same reason and is not treated
    // as assent. A server that did not say which revision it selected has not
    // agreed to anything, and reading silence as agreement is the same defect
    // this repository refuses everywhere else: an absent answer promoted to a
    // positive one.
    //
    // This is checked *before* `notifications/initialized`, because that
    // notification is the client declaring the session open. Sending it and then
    // objecting would mean announcing agreement to a revision this client had
    // already determined it does not speak.
    const negotiated = initialized?.protocolVersion;
    if (negotiated !== MCP_PROTOCOL_VERSION) {
      const described =
        negotiated === undefined
          ? "no protocolVersion"
          : `protocolVersion ${JSON.stringify(negotiated)}`;
      await this.stop();
      throw new Error(
        `MCP protocol negotiation failed: this client speaks only ${MCP_PROTOCOL_VERSION}, ` +
          `and the server answered with ${described}.`,
      );
    }

    // The spec requires this notification before any other request. Omitting it
    // works against permissive servers and fails against strict ones, which is
    // the worst kind of bug: correct on the machine it was written on.
    this.#notify("notifications/initialized", {});

    return {
      serverName: initialized?.serverInfo?.name ?? null,
      serverVersion: initialized?.serverInfo?.version ?? null,
    };
  }

  /** The tools the server advertises. Used to prove a tool exists before relying on it. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.#request("tools/list", {})) as { tools?: McpToolDescriptor[] } | null;
    return result?.tools ?? [];
  }

  /**
   * Call a tool and return its decoded payload.
   *
   * The MCP result envelope carries a list of content blocks plus an `isError`
   * flag, and the DataHub server returns its data as JSON inside a text block.
   * Both layers can fail independently — a call can succeed at the protocol
   * level and carry `isError: true`, or carry text that is not JSON — so both
   * are checked here rather than left for a caller to rediscover.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    let raw: unknown;
    try {
      raw = await this.#request("tools/call", { name, arguments: args });
    } catch (error) {
      return { ok: false, value: null, error: (error as Error).message };
    }

    const envelope = raw as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | null;
    const text = (envelope?.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");

    if (envelope?.isError) {
      return { ok: false, value: null, error: `tool ${name} reported an error: ${text.slice(0, 400)}` };
    }
    if (!text) {
      // Distinct from a tool that returned JSON `null`. No content at all means
      // the envelope carried nothing to interpret, and guessing which emptiness
      // it was is how a non-answer becomes an answer.
      return { ok: false, value: null, error: `tool ${name} returned no text content` };
    }

    try {
      return { ok: true, value: JSON.parse(text), error: null };
    } catch {
      // Not every tool returns JSON, and a plain-text answer is a legitimate
      // result rather than a failure. It is handed back as the string it is.
      return { ok: true, value: text, error: null };
    }
  }

  /** Shut the server down. Safe to call more than once. */
  async stop(): Promise<void> {
    if (!this.#child || this.#closed) return;
    this.#closed = true;
    if (this.#killOnExit) {
      process.removeListener("exit", this.#killOnExit);
      this.#killOnExit = null;
    }
    const child = this.#child;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const done = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(done);
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Framing
  // -------------------------------------------------------------------------

  #consume(chunk: string): void {
    this.#buffer += chunk;
    // Newline-delimited framing: everything up to the last newline is complete
    // messages, and the remainder is a partial frame that stays buffered. A
    // JSON-RPC body never contains a raw newline, so splitting here is safe.
    let newline = this.#buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) this.#dispatch(line);
      newline = this.#buffer.indexOf("\n");
    }
  }

  #dispatch(line: string): void {
    let message: { id?: number; result?: unknown; error?: JsonRpcError };
    try {
      message = JSON.parse(line);
    } catch {
      // A frame this client cannot parse is not a request failure — it belongs
      // to nobody. Recording it keeps it diagnosable without failing a call that
      // may still be answered correctly.
      this.#retainStderr(`unparseable frame from server: ${line.slice(0, 200)}`);
      return;
    }

    if (typeof message.id !== "number") return; // a notification, or a server request this client does not serve
    const pending = this.#pending.get(message.id);
    if (!pending) return; // already timed out; its caller has moved on

    this.#pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(
        new Error(`JSON-RPC error ${message.error.code ?? "?"}: ${message.error.message ?? "unspecified"}`),
      );
      return;
    }
    pending.resolve(message.result ?? null);
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#exitReason) return Promise.reject(new Error(this.#exitReason));
    const child = this.#child;
    if (!child) return Promise.reject(new Error("MCP client not started"));

    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${this.#requestTimeoutMs}ms`));
      }, this.#requestTimeoutMs);
      // Unref so a stuck request cannot by itself hold the process open past the
      // point where the caller has given up on it.
      timer.unref?.();

      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`could not write ${method} to the MCP server: ${error.message}`));
      });
    });
  }

  /**
   * Fire-and-forget, but not fail-and-forget.
   *
   * A notification has no id and so no pending entry to reject, which is exactly
   * why the failure has to be captured rather than dropped: nothing downstream
   * would ever notice. The error goes into the retained stderr, where a failed
   * handshake can quote it.
   */
  #notify(method: string, params: Record<string, unknown>): void {
    this.#child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, (error) => {
      if (error) this.#retainStderr(`could not send ${method}: ${error.message}`);
    });
  }

  /** Fail everything outstanding with a shared cause, and remember it for later callers. */
  #die(reason: string): void {
    this.#exitReason ??= reason;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.#pending.delete(id);
    }
  }
}
