import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY = 50 * 1024 * 1024; // git bundles can be large

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function parseJson<T = Record<string, unknown>>(raw: Buffer): T {
  return JSON.parse(raw.toString("utf8") || "{}") as T;
}

export function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}
