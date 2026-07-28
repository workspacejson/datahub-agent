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

/** The protocol revision this client speaks. Sent in the handshake and checked. */
export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

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
  #stderr: string[] = [];
  #closed = false;
  /** Set when the process dies, so late callers get the cause and not a timeout. */
  #exitReason: string | null = null;

  readonly #server: McpServerCommand;
  readonly #requestTimeoutMs: number;
  readonly #onStderr: ((line: string) => void) | undefined;

  constructor(server: McpServerCommand, options: McpClientOptions = {}) {
    this.#server = server;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.#onStderr = options.onStderr;
  }

  /** The server's stderr, retained so a failed handshake can say why. */
  get stderr(): string {
    return this.#stderr.join("\n");
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

    const child = spawn(this.#server.command, [...this.#server.args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.#server.env },
    });
    this.#child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        // Bounded: a chatty server must not grow this without limit for the
        // lifetime of a run. The head is kept rather than the tail because the
        // first failure is what explains the rest.
        if (this.#stderr.length < 200) this.#stderr.push(line);
        this.#onStderr?.(line);
      }
    });

    // A spawn that fails (missing binary) and one that exits (crash) are
    // different faults with the same consequence: every pending request must be
    // failed with the cause, not left to time out into a less informative error.
    child.on("error", (error) => this.#die(`could not start "${this.#server.command}": ${error.message}`));
    child.on("exit", (code, signal) =>
      this.#die(
        `MCP server exited (${signal ? `signal ${signal}` : `code ${code}`})` +
          (this.#stderr.length ? `: ${this.#stderr.slice(-3).join(" | ")}` : ""),
      ),
    );

    const initialized = (await this.#request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
    })) as { serverInfo?: { name?: string; version?: string } } | null;

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
      this.#stderr.push(`unparseable frame from server: ${line.slice(0, 200)}`);
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

  #notify(method: string, params: Record<string, unknown>): void {
    this.#child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
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
