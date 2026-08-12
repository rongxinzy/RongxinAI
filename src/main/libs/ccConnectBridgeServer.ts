import http from "node:http";

import { CcConnectRequestAuthenticator } from './ccConnectRequestAuthenticator';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type CcConnectTurnRequest = {
  requestId: string;
  project: string;
  message: {
    sessionKey: string;
    platform: string;
    messageId: string;
    channelId: string;
    userId: string;
    userName?: string;
    chatName?: string;
    content: string;
    extraContent?: string;
    images?: unknown[];
    files?: unknown[];
    userMessageTimeMs?: number;
  };
};

export type CcConnectCronTrigger = {
  requestId: string;
  project: string;
  taskId: string;
  scheduleVersion: string;
  scheduledAt: string;
};

export interface CcConnectBridgeHandlers {
  onTurn(request: CcConnectTurnRequest): Promise<{ content: string }>;
  onCronTrigger(trigger: CcConnectCronTrigger): Promise<void>;
}

/** Loopback-only bridge between the trimmed channel sidecar and ZhiYuan. */
export class CcConnectBridgeServer {
  private server: http.Server | null = null;
  private readonly authenticator: CcConnectRequestAuthenticator;

  constructor(
    private readonly token: string,
    private readonly handlers: CcConnectBridgeHandlers,
  ) {
    if (!token.trim()) throw new Error("cc-connect bridge token is required");
    this.authenticator = new CcConnectRequestAuthenticator(token);
  }

  async start(): Promise<string> {
    if (this.server) throw new Error("cc-connect bridge already started");
    this.server = http.createServer(
      (request, response) => void this.handle(request, response),
    );
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("cc-connect bridge has no TCP address");
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    try {
      if (!this.authenticator.authorize(request)) return void response.writeHead(401).end();
      if (request.method !== "POST") return void response.writeHead(404).end();
      const body = await readJson(request);
      if (request.url === "/v1/cc-connect/turn") {
        if (!isTurnRequest(body))
          return void response.writeHead(400).end("invalid turn request");
        const result = await this.handlers.onTurn(body);
        if (!result.content.trim())
          throw new Error("Pi bridge returned an empty response");
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result));
        return;
      }
      if (request.url === "/v1/cc-connect/cron/trigger") {
        if (!isCronTrigger(body))
          return void response.writeHead(400).end("invalid cron trigger");
        await this.handlers.onCronTrigger(body);
        response.writeHead(204).end();
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500).end(message);
    }
  }
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTurnRequest(value: unknown): value is CcConnectTurnRequest {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.requestId) ||
    !nonEmptyString(value.project)
  )
    return false;
  const message = value.message;
  return (
    isRecord(message) &&
    [
      "sessionKey",
      "platform",
      "messageId",
      "channelId",
      "userId",
      "content",
    ].every((key) => nonEmptyString(message[key]))
  );
}

function isCronTrigger(value: unknown): value is CcConnectCronTrigger {
  return (
    isRecord(value) &&
    ["requestId", "project", "taskId", "scheduleVersion", "scheduledAt"].every(
      (key) => nonEmptyString(value[key]),
    ) &&
    !Number.isNaN(Date.parse(value.scheduledAt as string))
  );
}
