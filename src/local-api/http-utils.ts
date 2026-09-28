import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 1_000_000;

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer | "too_large"> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > limit) return "too_large";
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

/** 413 sem deixar a conexão keep-alive num estado quebrado: fecha a conexão e descarta o resto do corpo. */
export function payloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Connection", "close");
    req.resume();
    sendJson(res, 413, { message: "Corpo grande demais.", error: "payload_too_large", statusCode: 413 });
}
