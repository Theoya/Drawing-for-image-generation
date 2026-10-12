/**
 * Sketchpad — pi tools for the local Sketchpad Electron app.
 *
 * Turns the repeated shell dance (find PID, taskkill, spawn electron, poll
 * health, POST strokes, grab screenshots) into single tool calls.
 *
 * Talks directly to the app's command server (http://127.0.0.1:8391) and
 * manages the electron process itself, so no MCP server is required.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", "..");
const ELECTRON = path.join(APP_ROOT, "node_modules", "electron", "dist", "electron.exe");
const APP_PORT = 8391;
const APP_URL = process.env.SKETCHPAD_COMMAND_URL || `http://127.0.0.1:${APP_PORT}`;

/* ================= app process management ================= */

function findAppPid(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${APP_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`,
      ],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(pid) && pid > 0 ? pid : null);
      }
    );
  });
}

function stopApp(): Promise<string> {
  return new Promise((resolve) => {
    findAppPid().then((pid) => {
      if (!pid) return resolve("not running");
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], (err, _out, stderr) =>
        resolve(err ? `failed to stop pid ${pid}: ${stderr || err.message}` : `stopped pid ${pid}`)
      );
    });
  });
}

function startApp(): void {
  const child = spawn(ELECTRON, ["."], {
    cwd: APP_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function waitForApp(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${APP_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const body: any = await res.json().catch(() => ({}));
      if (res.ok && body && body.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ================= command server ================= */

async function appCommand(action: string, payload: Record<string, unknown> = {}, timeoutMs = 25000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new Error(`sketchpad app not reachable at ${APP_URL} — run sketchpad_app with action "start" (${err?.message || err})`);
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: `app responded ${res.status}: ${text.slice(0, 300)}` };
  }
  if (!data || typeof data !== "object") data = { ok: false, error: `unexpected app response: ${String(data).slice(0, 200)}` };
  return data;
}

function fail(data: any, what: string): never {
  throw new Error(data?.error || `${what} failed`);
}

function jsonResult(data: any, details?: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: details ?? data };
}

const TOOL_ENUM = Type.Union([
  Type.Literal("brush"),
  Type.Literal("pencil"),
  Type.Literal("marker"),
  Type.Literal("airbrush"),
  Type.Literal("eraser"),
]);

const POINT = Type.Object({
  x: Type.Number({ description: "Canvas x (0..canvas width)" }),
  y: Type.Number({ description: "Canvas y (0..canvas height)" }),
  p: Type.Optional(Type.Number({ description: "Pen pressure 0..1 (default 0.5); ramp it along a stroke for a natural shape" })),
});

/* ================= extension ================= */

export default function sketchpadExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "sketchpad_app",
    label: "Sketchpad App",
    description:
      'Manage the Sketchpad Electron app process. Actions: "status" (PID + health + tool state), "start", "stop", "restart" (stop, then start, waits until healthy). Use before drawing if the app may not be running.',
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("status"), Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")],
        { description: 'App action; default "status"', default: "status" }
      ),
    }),
    async execute(_id, params) {
      const action: string = params.action || "status";
      if (action === "status") {
        const pid = await findAppPid();
        let health: any = { up: false };
        let state: any = null;
        try {
          const res = await fetch(`${APP_URL}/health`, { signal: AbortSignal.timeout(2500) });
          health = { up: res.ok, ...(await res.json().catch(() => ({}))) };
          if (health.up) state = await appCommand("state", {}, 3000);
        } catch {
          health = { up: false };
        }
        return jsonResult({ app: { pid: pid ?? undefined, ...health }, state }, { pid, up: !!health.up });
      }
      if (action === "start") {
        const pid = await findAppPid();
        if (pid) return jsonResult({ ok: true, alreadyRunning: true, pid });
        startApp();
        const up = await waitForApp();
        if (up) return jsonResult({ ok: true, started: true });
        return jsonResult({ ok: false, error: "app did not become healthy within 30s — check node_modules/electron/dist/electron.exe and the app console" });
      }
      if (action === "stop") {
        const result = await stopApp();
        return jsonResult({ ok: true, result });
      }
      // restart
      const stopResult = await stopApp();
      await sleep(2000);
      startApp();
      const up = await waitForApp(35000);
      return up
        ? jsonResult({ ok: true, restarted: true, stop: stopResult })
        : jsonResult({ ok: false, error: "app did not come back healthy after restart", stop: stopResult });
    },
  });

  pi.registerTool({
    name: "sketchpad_state",
    label: "Sketchpad State",
    description:
      "Report the sketchpad app's current state: tool, color, size, opacity, pen detection, canvas orientation (landscape 1600x1000 / portrait 1000x1600) and dimensions.",
    parameters: Type.Object({}),
    async execute() {
      const data = await appCommand("state");
      if (!data.ok) fail(data, "sketchpad_state");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_set_tool",
    label: "Sketchpad Set Tool",
    description: "Select the active drawing tool (brush, pencil, marker, airbrush, eraser).",
    parameters: Type.Object({ tool: TOOL_ENUM }),
    async execute(_id, params) {
      const data = await appCommand("set_tool", { tool: params.tool });
      if (!data.ok) fail(data, "sketchpad_set_tool");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_set_color",
    label: "Sketchpad Set Color",
    description: 'Set the pen color (hex, e.g. "#ff3b30").',
    parameters: Type.Object({ color: Type.String({ description: "Hex color like #ff3b30" }) }),
    async execute(_id, params) {
      const data = await appCommand("set_color", { color: params.color });
      if (!data.ok) fail(data, "sketchpad_set_color");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_set_size",
    label: "Sketchpad Set Size",
    description: "Set pen size (1-120).",
    parameters: Type.Object({ size: Type.Number() }),
    async execute(_id, params) {
      const data = await appCommand("set_size", { size: params.size });
      if (!data.ok) fail(data, "sketchpad_set_size");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_set_opacity",
    label: "Sketchpad Set Opacity",
    description: "Set pen opacity (0.01-1).",
    parameters: Type.Object({ opacity: Type.Number() }),
    async execute(_id, params) {
      const data = await appCommand("set_opacity", { opacity: params.opacity });
      if (!data.ok) fail(data, "sketchpad_set_opacity");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_draw",
    label: "Sketchpad Draw",
    description:
      "Draw a freehand stroke on the canvas like a human with a pen. Canvas space is 1600x1000 (landscape) or 1000x1600 (portrait), (0,0) = top-left — check sketchpad_state for the current dimensions. Provide 2+ points; for curves use 8-30 smoothly spaced points and ramp p (e.g. 0.2 -> 0.9 -> 0.1) for a natural pressure shape. tool/color/size/opacity override just this stroke.",
    parameters: Type.Object({
      points: Type.Array(POINT, { minItems: 2, description: "Stroke points in canvas coordinates" }),
      tool: Type.Optional(TOOL_ENUM),
      color: Type.Optional(Type.String({ description: "Hex color for this stroke only" })),
      size: Type.Optional(Type.Number({ description: "Pen size for this stroke only (1-120)" })),
      opacity: Type.Optional(Type.Number({ description: "Opacity for this stroke only (0.01-1)" })),
    }),
    async execute(_id, params) {
      const payload: Record<string, unknown> = { points: params.points };
      if (params.tool) payload.tool = params.tool;
      if (params.color) payload.color = params.color;
      if (params.size != null) payload.size = params.size;
      if (params.opacity != null) payload.opacity = params.opacity;
      const data = await appCommand("draw", payload);
      if (!data.ok) fail(data, "sketchpad_draw");
      return jsonResult({ ok: true, pointsDrawn: data.points });
    },
  });

  pi.registerTool({
    name: "sketchpad_flip",
    label: "Sketchpad Flip",
    description:
      "Rotate the canvas 90 degrees (landscape 1600x1000 <-> portrait 1000x1600), carrying the current drawing with it. The orientation is remembered across app relaunches.",
    parameters: Type.Object({}),
    async execute() {
      const data = await appCommand("flip");
      if (!data.ok) fail(data, "sketchpad_flip");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_clear",
    label: "Sketchpad Clear",
    description: "Clear the whole canvas (undoable via sketchpad_undo).",
    parameters: Type.Object({}),
    async execute() {
      const data = await appCommand("clear");
      if (!data.ok) fail(data, "sketchpad_clear");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_undo",
    label: "Sketchpad Undo",
    description: "Undo the last action on the canvas.",
    parameters: Type.Object({}),
    async execute() {
      const data = await appCommand("undo");
      if (!data.ok) fail(data, "sketchpad_undo");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_redo",
    label: "Sketchpad Redo",
    description: "Redo the last undone action on the canvas.",
    parameters: Type.Object({}),
    async execute() {
      const data = await appCommand("redo");
      if (!data.ok) fail(data, "sketchpad_redo");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_screenshot",
    label: "Sketchpad Screenshot",
    description: "Capture the current canvas as a PNG image (returned as an image you can see, on a black background).",
    parameters: Type.Object({
      maxWidth: Type.Optional(Type.Number({ description: "Downscale to this width (default 800, max 1600)" })),
    }),
    async execute(_id, params) {
      const data = await appCommand("screenshot", { maxWidth: params.maxWidth ?? 800 });
      if (!data.ok || !data.dataUrl) fail(data, "sketchpad_screenshot");
      const b64 = String(data.dataUrl).split(",")[1];
      if (!b64) fail(data, "sketchpad_screenshot (no base64 payload)");
      return {
        content: [
          { type: "image" as const, data: b64, mimeType: "image/png" },
          { type: "text" as const, text: `Sketchpad canvas screenshot (${data.width}x${data.height}).` },
        ],
        details: { width: data.width, height: data.height },
      };
    },
  });

  pi.registerTool({
    name: "sketchpad_save",
    label: "Sketchpad Save",
    description: "Save the canvas to a PNG/JPG file (black background composited in). Returns the written path.",
    parameters: Type.Object({
      format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpg")])),
      path: Type.Optional(Type.String({ description: "Absolute path; default ./sketchpad-out/sketch-<timestamp>.png" })),
    }),
    async execute(_id, params) {
      const payload: Record<string, unknown> = {};
      if (params.format) payload.format = params.format;
      if (params.path) payload.path = params.path;
      const data = await appCommand("save", payload);
      if (!data.ok && !data.saved) fail(data, "sketchpad_save");
      return jsonResult(data);
    },
  });

  pi.registerTool({
    name: "sketchpad_load",
    label: "Sketchpad Load",
    description: "Load an image file from disk onto the canvas (fit-centered, undoable).",
    parameters: Type.Object({ path: Type.String({ description: "Absolute path to the image file" }) }),
    async execute(_id, params) {
      const data = await appCommand("load", { path: params.path });
      if (!data.ok) fail(data, "sketchpad_load");
      return jsonResult(data);
    },
  });
}
