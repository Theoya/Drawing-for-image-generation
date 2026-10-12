// Draw a cat onto the live sketchpad via the pi extension, then save a screenshot.
const PI_LOADER = "file:///C:/Users/THadfield/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
const { loadExtensions } = await import(PI_LOADER);
const DIR = String.raw`C:\Users\THadfield\Drawing for image generation`;
const { extensions, errors } = await loadExtensions([DIR + String.raw`\.pi\extensions\sketchpad.ts`], DIR);
if (errors.length) { console.error(errors[0].error); process.exit(1); }
const tools = extensions[0].tools;
async function call(name, params = {}) {
  const t = tools.get(name);
  if (!t) throw new Error("no tool " + name);
  return t.definition.execute("t1", params, new AbortController().signal);
}
const text = (r) => (r.content || []).map((c) => (c.type === "text" ? c.text : "[img]")).join(" | ");

await call("sketchpad_clear");

// ---- Cat (canvas 1600x1000). Center ~ (800, 500). ----
// Head: circle. Sample 36 points.
const cx = 800, cy = 520, r = 210;
const head = [];
for (let i = 0; i <= 36; i++) {
  const a = (i / 36) * Math.PI * 2;
  head.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) });
}
await call("sketchpad_set_color", { color: "#e8871e" });
await call("sketchpad_set_size", { size: 10 });
await call("sketchpad_set_opacity", { opacity: 1 });
const headRes = await call("sketchpad_draw", { points: head, color: "#e8871e", size: 10 });
console.log("head:", text(headRes));

// Ears: two triangles on top.
const earL = [
  { x: 640, y: 400 }, { x: 610, y: 250 }, { x: 760, y: 350 }, { x: 640, y: 400 },
];
const earR = [
  { x: 960, y: 400 }, { x: 990, y: 250 }, { x: 840, y: 350 }, { x: 960, y: 400 },
];
await call("sketchpad_draw", { points: earL, color: "#e8871e", size: 10 });
await call("sketchpad_draw", { points: earR, color: "#e8871e", size: 10 });

// Inner ears (darker)
await call("sketchpad_draw", { points: [{ x: 650, y: 380 }, { x: 632, y: 290 }, { x: 726, y: 356 }, { x: 650, y: 380 }], color: "#b3541e", size: 6 });
await call("sketchpad_draw", { points: [{ x: 950, y: 380 }, { x: 968, y: 290 }, { x: 874, y: 356 }, { x: 950, y: 380 }], color: "#b3541e", size: 6 });

// Eyes: two circles.
function circle(cx2, cy2, r2, n = 28) {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; p.push({ x: Math.round(cx2 + r2 * Math.cos(a)), y: Math.round(cy2 + r2 * Math.sin(a)) }); }
  return p;
}
await call("sketchpad_draw", { points: circle(720, 480, 34), color: "#222", size: 5 });
await call("sketchpad_draw", { points: circle(880, 480, 34), color: "#222", size: 5 });
// Pupils
await call("sketchpad_draw", { points: circle(720, 480, 12, 18), color: "#111", size: 8 });
await call("sketchpad_draw", { points: circle(880, 480, 12, 18), color: "#111", size: 8 });

// Nose (small triangle)
await call("sketchpad_draw", { points: [{ x: 800, y: 560 }, { x: 780, y: 585 }, { x: 820, y: 585 }, { x: 800, y: 560 }], color: "#c0392b", size: 6 });
// Mouth: two arcs from nose
await call("sketchpad_draw", { points: [{ x: 800, y: 585 }, { x: 795, y: 620 }, { x: 770, y: 645 }], color: "#222", size: 4 });
await call("sketchpad_draw", { points: [{ x: 800, y: 585 }, { x: 805, y: 620 }, { x: 830, y: 645 }], color: "#222", size: 4 });

// Whiskers
for (const [sx, side] of [[640, -1], [960, 1]]) {
  await call("sketchpad_draw", { points: [{ x: sx, y: 585 }, { x: sx + side * 160, y: 560 }], color: "#555", size: 3 });
  await call("sketchpad_draw", { points: [{ x: sx, y: 600 }, { x: sx + side * 170, y: 605 }], color: "#555", size: 3 });
  await call("sketchpad_draw", { points: [{ x: sx, y: 615 }, { x: sx + side * 160, y: 650 }], color: "#555", size: 3 });
}

const shot = await call("sketchpad_screenshot", { maxWidth: 800 });
console.log("screenshot:", text(shot).slice(0, 200));

const saved = await call("sketchpad_save", { path: DIR + "\\sketchpad-out\\cat.png" });
console.log("save:", text(saved));
process.exit(0);
