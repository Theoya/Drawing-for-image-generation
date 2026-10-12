#!/usr/bin/env node
/* Sketchpad MCP server — drives the Sketchpad Electron app like a human.
 *
 * Transports:
 *   node mcp-server.js            streamable-HTTP MCP at http://127.0.0.1:8392/mcp
 *   node mcp-server.js --stdio    stdio MCP (newline-delimited JSON-RPC 2.0)
 *
 * The server forwards tool calls to the running app's command server
 * (http://127.0.0.1:8391/command). The app must be open.
 *
 * Env:
 *   SKETCHPAD_COMMAND_URL  (default http://127.0.0.1:8391/command)
 *   SKETCHPAD_MCP_PORT     (default 8392, HTTP mode only)
 */
'use strict';

const http = require('http');

const APP_COMMAND_URL = process.env.SKETCHPAD_COMMAND_URL || 'http://127.0.0.1:8391/command';
const HTTP_PORT = parseInt(process.env.SKETCHPAD_MCP_PORT || '8392', 10);
const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'sketchpad_state',
    description: 'Get the current Sketchpad app state: active tool, color, size, opacity, canvas dimensions, and whether a pen has been detected.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sketchpad_set_tool',
    description: 'Select the active drawing tool: brush (smooth pressure-sensitive), pencil (grainy), marker (translucent, blends on overlap), airbrush (soft spray), eraser.',
    inputSchema: {
      type: 'object',
      properties: { tool: { type: 'string', enum: ['brush', 'pencil', 'marker', 'airbrush', 'eraser'] } },
      required: ['tool']
    }
  },
  {
    name: 'sketchpad_set_color',
    description: 'Set the pen color as a hex string, e.g. "#ff3b30".',
    inputSchema: {
      type: 'object',
      properties: { color: { type: 'string', description: 'Hex color, e.g. "#ff3b30"' } },
      required: ['color']
    }
  },
  {
    name: 'sketchpad_set_size',
    description: 'Set the base stroke size (1-120; pressure scales it up/down while drawing).',
    inputSchema: {
      type: 'object',
      properties: { size: { type: 'number', minimum: 1, maximum: 120 } },
      required: ['size']
    }
  },
  {
    name: 'sketchpad_set_opacity',
    description: 'Set stroke opacity from 0.01 to 1.0.',
    inputSchema: {
      type: 'object',
      properties: { opacity: { type: 'number', minimum: 0.01, maximum: 1 } },
      required: ['opacity']
    }
  },
  {
    name: 'sketchpad_draw',
    description: "Draw a freehand stroke on the canvas, like a human with a pen. Canvas space is 1600x1000 in landscape or 1000x1600 in portrait (0,0 = top-left; check sketchpad_state for current dimensions). Provide 2+ points as {x, y, p} where p is optional pen pressure 0..1 (default 0.5). For curves, supply 8-30 smoothly spaced points and ramp p (e.g. 0.2 -> 0.9 -> 0.1) for a natural pressure shape. Optionally override tool/color/size/opacity for just this stroke.",
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array', minItems: 2,
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1600 },
              y: { type: 'number', minimum: 0, maximum: 1000 },
              p: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['x', 'y']
          }
        },
        tool: { type: 'string', enum: ['brush', 'pencil', 'marker', 'airbrush', 'eraser'] },
        color: { type: 'string', description: 'Hex color for this stroke only' },
        size: { type: 'number', minimum: 1, maximum: 120 },
        opacity: { type: 'number', minimum: 0.01, maximum: 1 }
      },
      required: ['points']
    }
  },
  {
    name: 'sketchpad_undo',
    description: 'Undo the last stroke or action.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sketchpad_redo',
    description: 'Redo the last undone action.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sketchpad_clear',
    description: 'Clear the whole canvas (undoable).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sketchpad_screenshot',
    description: "Capture the current canvas so you can see what's drawn. Returns the canvas as a PNG image.",
    inputSchema: {
      type: 'object',
      properties: { maxWidth: { type: 'number', minimum: 32, maximum: 1600, description: 'Downscale width (default 800)' } }
    }
  },
  {
    name: 'sketchpad_save',
    description: 'Save the canvas to a PNG (default) or JPEG file. If path is omitted, saves under ./sketchpad-out/. Returns the saved file path.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['png', 'jpg'] },
        path: { type: 'string', description: 'Absolute file path (optional)' }
      }
    }
  },
  {
    name: 'sketchpad_load',
    description: 'Load an image file from disk onto the canvas (fit-centered, undoable).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to the image file' } },
      required: ['path']
    }
  },
  {
    name: 'sketchpad_flip',
    description: 'Rotate the canvas 90 degrees (landscape 1600x1000 <-> portrait 1000x1600), carrying the current drawing with it. The orientation is remembered across app relaunches. Returns the new orientation and canvas dimensions.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function toolToCmd(name) {
  return name.replace(/^sketchpad_/, '');
}

async function callApp(cmd, args) {
  const res = await fetch(APP_COMMAND_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: cmd, payload: args || {} }),
    signal: AbortSignal.timeout(25000)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = { ok: false, error: `app responded ${res.status}: ${text.slice(0, 200)}` }; }
  if (res.status !== 200 && !data.ok) {
    data = { ok: false, error: data.error || `app command failed (HTTP ${res.status})` };
  }
  return data;
}

function toolResult(name, data) {
  if (name === 'sketchpad_screenshot' && data && data.ok && data.dataUrl) {
    return {
      content: [
        { type: 'image', data: data.dataUrl.split(',')[1], mimeType: 'image/png' },
        { type: 'text', text: `Canvas screenshot (${data.width}x${data.height}).` }
      ]
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/* ================= JSON-RPC dispatch ================= */

async function handleRpc(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  const respond = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const rpcError = (code, message) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return respond({
        protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'sketchpad', version: '1.0.0' },
        instructions: 'Drive the Sketchpad drawing app. Use sketchpad_draw with a sequence of points (canvas space is 1600x1000 landscape or 1000x1600 portrait — check sketchpad_state; optional p=pressure 0..1) to draw, sketchpad_flip to rotate the canvas, sketchpad_screenshot to see the result, sketchpad_save to write a file.'
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return respond({});
    case 'tools/list':
      return respond({ tools: TOOLS });
    case 'tools/call': {
      const name = params.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(-32602, `unknown tool: ${name}`);
      const args = params.arguments || {};
      let data;
      try {
        data = await callApp(toolToCmd(name), args);
      } catch (e) {
        data = { ok: false, error: `cannot reach the Sketchpad app at ${APP_COMMAND_URL} — is it running? (${e.message})` };
      }
      const result = toolResult(name, data);
      if (data && data.ok === false) result.isError = true;
      return respond(result);
    }
    default:
      return rpcError(-32601, `method not found: ${method}`);
  }
}

/* ================= transports ================= */

const stdio = process.argv.includes('--stdio');

if (stdio) {
  let buf = '';
  process.stdin.on('data', async (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const out = await handleRpc(msg);
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    }
  });
  process.stderr.write('Sketchpad MCP server (stdio) ready\n');
} else {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, server: 'sketchpad-mcp', appCommandUrl: APP_COMMAND_URL }));
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let msgs;
        try { msgs = JSON.parse(body || '[]'); }
        catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
          return;
        }
        const arr = Array.isArray(msgs) ? msgs : [msgs];
        const out = [];
        for (const m of arr) {
          const r = await handleRpc(m);
          if (r) out.push(r);
        }
        if (!out.length) { res.writeHead(202, { 'content-type': 'application/json' }); res.end('{}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.length === 1 ? out[0] : out));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found — POST /mcp' }));
  });
  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`Sketchpad MCP server (HTTP) on http://127.0.0.1:${HTTP_PORT}/mcp  [app: ${APP_COMMAND_URL}]`);
  });
}
