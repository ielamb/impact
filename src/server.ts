import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

type BottleStatus = "sealed" | "opened" | "alert";

interface BottleEvent {
  time: string;
  title: string;
  desc: string;
  type: string;
  tx: string;
  verified?: boolean;
}

interface Bottle {
  id: string;
  productType?: "proprietary";
  name: string;
  winery: string;
  vintage: number;
  tier: string;
  tierLabel: string;
  status: BottleStatus;
  emoji: string;
  hash: string;
  openedAt?: string;
  openedLocation?: string;
  openingNote?: string;
  readings: Array<Record<string, string>>;
  events: BottleEvent[];
  tokenId?: string;
  claimCodeHash?: string;
  claimCode?: string;
  purchaseStatus?: "available" | "purchased";
  claimStatus?: "unclaimed" | "claimed";
  owner?: string;
  provenance?: Array<{ action: string; actor: string; tx: string; at: string }>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(root, "data", "bottles.json");
const htmlPath = join(root, "file.html");
const myBottlesHtmlPath = join(root, "my-bottles.html");
const port = Number(process.env.PORT ?? 3000);

async function readBottles(): Promise<Bottle[]> {
  const contents = await readFile(dataPath, "utf8");
  const bottles = JSON.parse(contents) as Bottle[];
  return bottles.map((bottle, index) => ({
    ...bottle,
    productType: "proprietary",
    tokenId: bottle.tokenId ?? String(1001 + index),
    purchaseStatus: bottle.purchaseStatus ?? "purchased",
    claimStatus: bottle.claimStatus ?? "unclaimed",
    provenance: bottle.provenance ?? [],
  }));
}

async function writeBottles(bottles: Bottle[]): Promise<void> {
  await writeFile(dataPath, `${JSON.stringify(bottles, null, 2)}\n`, "utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request body is too large");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function bottleSummary(bottle: Bottle): Bottle {
  const { claimCodeHash, claimCode, ...safeBottle } = bottle;
  return safeBottle;
}

function hashValue(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && parts.length === 2 && parts[1] === "bottles") {
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const status = url.searchParams.get("status");
    const bottles = await readBottles();
    const filtered = bottles.filter((bottle) => {
      const haystack = `${bottle.id} ${bottle.name} ${bottle.winery} ${bottle.vintage} ${bottle.openingNote ?? ""}`.toLowerCase();
      return haystack.includes(search) && (!status || bottle.status === status);
    });
    sendJson(response, 200, filtered.map(bottleSummary));
    return;
  }

  if (request.method === "GET" && parts.length === 3 && parts[1] === "bottles") {
    const bottles = await readBottles();
    const bottle = bottles.find((candidate) => candidate.id === decodeURIComponent(parts[2]));
    if (!bottle) {
      sendError(response, 404, "Bottle not found");
      return;
    }
    sendJson(response, 200, bottle);
    return;
  }

  if (request.method === "POST" && parts.length === 4 && parts[1] === "bottles" && parts[3] === "claim") {
      const payload = await readBody(request) as Record<string, unknown>;
      const bottles = await readBottles();
      const bottle = bottles.find((candidate) => candidate.id === decodeURIComponent(parts[2]));
      const wallet = typeof payload.walletAddress === "string" ? payload.walletAddress.trim() : "";
      if (!bottle) { sendError(response, 404, "Bottle not found"); return; }
      if (bottle.productType !== "proprietary") { sendError(response, 403, "Only VinChain proprietary bottles can be claimed"); return; }
      if (bottle.purchaseStatus !== "purchased") { sendError(response, 409, "Bottle is not available to claim"); return; }
      if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) { sendError(response, 400, "Enter a valid demo wallet address"); return; }
      if (bottle.claimStatus === "claimed") { sendError(response, 409, "Bottle has already been claimed"); return; }
      bottle.claimStatus = "claimed";
      bottle.owner = wallet;
      const tx = `demo-${randomUUID()}`;
      bottle.events.unshift({ time: new Date().toISOString(), title: "NFT claimed", desc: `Token #${bottle.tokenId} minted to ${wallet}`, type: "good", tx, verified: true });
      bottle.provenance?.push({ action: "claimed", actor: wallet, tx, at: new Date().toISOString() });
      await writeBottles(bottles);
      sendJson(response, 200, bottle);
      return;
  }

  if (request.method === "POST" && parts.length === 4 && parts[1] === "bottles" && parts[3] === "transfer") {
      const payload = await readBody(request) as Record<string, unknown>;
      const bottles = await readBottles();
      const bottle = bottles.find((candidate) => candidate.id === decodeURIComponent(parts[2]));
      const to = typeof payload.to === "string" ? payload.to.trim() : "";
      if (!bottle) { sendError(response, 404, "Bottle not found"); return; }
      if (bottle.claimStatus !== "claimed" || !bottle.owner) { sendError(response, 403, "Only a claimed bottle can be transferred"); return; }
      if (!/^0x[a-fA-F0-9]{40}$/.test(to)) { sendError(response, 400, "Enter a valid recipient wallet address"); return; }
      bottle.owner = to;
      const tx = `demo-${randomUUID()}`;
      bottle.events.unshift({ time: new Date().toISOString(), title: "NFT transferred", desc: `Token #${bottle.tokenId} transferred to ${to}`, type: "info", tx, verified: true });
      bottle.provenance?.push({ action: "transferred", actor: to, tx, at: new Date().toISOString() });
      await writeBottles(bottles);
      sendJson(response, 200, bottle);
      return;
  }

  if (request.method === "GET" && parts.length === 4 && parts[1] === "bottles" && parts[3] === "verify") {
      const bottles = await readBottles();
      const bottle = bottles.find((candidate) => candidate.id === decodeURIComponent(parts[2]));
      if (!bottle) { sendError(response, 404, "Bottle not found"); return; }
      sendJson(response, 200, { verified: true, network: "VinChain demo ledger", tokenId: bottle.tokenId ?? null, owner: bottle.owner ?? null, provenance: bottle.provenance ?? [], events: bottle.events });
      return;
  }

  if (request.method === "POST" && parts.length === 4 && parts[1] === "bottles" && parts[3] === "memories") {
    const bottleId = decodeURIComponent(parts[2]);
    const payload = await readBody(request);
    if (!payload || typeof payload !== "object") {
      sendError(response, 400, "A JSON object is required");
      return;
    }

    const { note, openedAt, openedLocation } = payload as Record<string, unknown>;
    if (typeof note !== "string" || note.trim().length === 0 || note.trim().length > 2_000) {
      sendError(response, 400, "Note must contain between 1 and 2,000 characters");
      return;
    }

    const bottles = await readBottles();
    const bottle = bottles.find((candidate) => candidate.id === bottleId);
    if (!bottle) {
      sendError(response, 404, "Bottle not found");
      return;
    }

    const eventTime = typeof openedAt === "string" && !Number.isNaN(Date.parse(openedAt))
      ? new Date(openedAt).toISOString()
      : new Date().toISOString();
    bottle.status = "opened";
    bottle.openedAt = eventTime;
    bottle.openingNote = note.trim();
    if (typeof openedLocation === "string" && openedLocation.trim()) {
      bottle.openedLocation = openedLocation.trim();
    }
    bottle.events.unshift({
      time: eventTime,
      title: "Bottle opened",
      desc: "Opening memory recorded",
      type: "warn",
      tx: `local-${randomUUID()}`,
      verified: true,
    });
    const memoryTx = bottle.events[0].tx;
    bottle.provenance ??= [];
    bottle.provenance.push({ action: "opened", actor: "memory-holder", tx: memoryTx, at: eventTime });

    await writeBottles(bottles);
    sendJson(response, 201, bottle);
    return;
  }

  sendError(response, 404, "API route not found");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendError(response, 405, "Method not allowed");
      return;
    }

    const requestedPath = url.pathname === "/" ? "/file.html" : url.pathname;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root) || ![htmlPath, myBottlesHtmlPath].includes(filePath)) {
      sendError(response, 404, "File not found");
      return;
    }
    const html = await readFile(filePath);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : html);
  } catch (error) {
    console.error(error);
    sendError(response, 500, "Internal server error");
  }
});

server.listen(port, () => {
  console.log(`VinChain running at http://localhost:${port}`);
});
