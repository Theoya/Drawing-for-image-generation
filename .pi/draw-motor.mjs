// Draw a technical (CAD-style) front elevation of an electric motor.
const PI_LOADER = "file:///C:/Users/THadfield/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
const { loadExtensions } = await import(PI_LOADER);
const DIR = String.raw`C:\Users\THadfield\Drawing for image generation`;
const { extensions, errors } = await loadExtensions([DIR + String.raw`\.pi\extensions\sketchpad.ts`], DIR);
if (errors.length) { console.error(errors[0].error); process.exit(1); }
const tools = extensions[0].tools;
async function call(name, params = {}) {
  const r = (await tools.get(name).definition.execute("t1", params, new AbortController().signal)) || {};
  return (r.content || []).map((c) => (c.type === "text" ? c.text : "[img]")).join(" | ");
}
const arc = (cx, cy, r, a0, a1, n = 20) => {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; p.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) }); }
  return p;
};
const line = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y2 }];
const rect = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 },
];
// dash-dot pattern between x1 and x2 at y
const dashDot = (x1, x2, y) => {
  const pts = []; let x = x1; let i = 0;
  while (x < x2) {
    const seg = i % 4 === 0 ? 45 : i % 4 === 1 ? 0 : i % 4 === 2 ? 10 : 0;
    if (i % 4 === 0) { pts.push({ x: Math.round(x), y }, { x: Math.round(Math.min(x + seg, x2)), y }); x += seg + 18; }
    else if (i % 4 === 2) { pts.push({ x: Math.round(x), y }, { x: Math.round(Math.min(x + seg, x2)), y }); x += seg + 18; }
    else x += 18;
    i++;
  }
  return pts;
};

await call("sketchpad_clear");

const BLUE = "#4a90d9", FIN = "#7db4e8", RED = "#e0533d";

// Housing: top + bottom rails
await call("sketchpad_draw", { points: line(575, 350, 925, 350), color: BLUE, size: 5 });
await call("sketchpad_draw", { points: line(575, 600, 925, 600), color: BLUE, size: 5 });
// End arcs (left: 90°→270°, right: -90°→90°)
await call("sketchpad_draw", { points: arc(575, 475, 125, Math.PI / 2, -Math.PI / 2, 24), color: BLUE, size: 5 });
await call("sketchpad_draw", { points: arc(925, 475, 125, -Math.PI / 2, Math.PI / 2, 24), color: BLUE, size: 5 });
// Front end bell inner circle
await call("sketchpad_draw", { points: arc(925, 475, 85, 0, Math.PI * 2, 32), color: FIN, size: 3 });

// Cooling fins
for (let x = 615; x <= 1015; x += 40) {
  await call("sketchpad_draw", { points: line(x, 352, x, 598), color: FIN, size: 2 });
}

// Terminal box on top
await call("sketchpad_draw", { points: rect(700, 270, 850, 350), color: BLUE, size: 5 });
// Box lid line
await call("sketchpad_draw", { points: line(700, 290, 850, 290), color: FIN, size: 2 });

// Shaft
await call("sketchpad_draw", { points: line(1050, 460, 1190, 460), color: BLUE, size: 5 });
await call("sketchpad_draw", { points: line(1050, 490, 1190, 490), color: BLUE, size: 5 });
await call("sketchpad_draw", { points: line(1190, 460, 1190, 490), color: BLUE, size: 5 });
// Keyway tick on shaft top
await call("sketchpad_draw", { points: line(1130, 460, 1160, 460), color: RED, size: 6 });

// Mounting feet
await call("sketchpad_draw", { points: [{ x: 520, y: 600 }, { x: 490, y: 665 }, { x: 590, y: 665 }, { x: 590, y: 600 }], color: BLUE, size: 5 });
await call("sketchpad_draw", { points: [{ x: 880, y: 600 }, { x: 850, y: 665 }, { x: 950, y: 665 }, { x: 950, y: 600 }], color: BLUE, size: 5 });
// Base line
await call("sketchpad_draw", { points: line(440, 665, 1060, 665), color: BLUE, size: 4 });

// Centerline (dash-dot, red)
await call("sketchpad_draw", { points: dashDot(380, 1230, 475), color: RED, size: 3 });

// Dimensions: overall length
await call("sketchpad_draw", { points: line(450, 670, 450, 750), color: BLUE, size: 2 });
await call("sketchpad_draw", { points: line(1050, 670, 1050, 750), color: BLUE, size: 2 });
await call("sketchpad_draw", { points: line(450, 740, 1050, 740), color: BLUE, size: 3 });
await call("sketchpad_draw", { points: [{ x: 450, y: 740 }, { x: 478, y: 732 }, { x: 478, y: 748 }, { x: 450, y: 740 }], color: BLUE, size: 3 });
await call("sketchpad_draw", { points: [{ x: 1050, y: 740 }, { x: 1022, y: 732 }, { x: 1022, y: 748 }, { x: 1050, y: 740 }], color: BLUE, size: 3 });
// Dimensions: height
await call("sketchpad_draw", { points: line(445, 350, 368, 350), color: BLUE, size: 2 });
await call("sketchpad_draw", { points: line(445, 600, 368, 600), color: BLUE, size: 2 });
await call("sketchpad_draw", { points: line(380, 350, 380, 600), color: BLUE, size: 3 });
await call("sketchpad_draw", { points: [{ x: 380, y: 350 }, { x: 372, y: 378 }, { x: 388, y: 378 }, { x: 380, y: 350 }], color: BLUE, size: 3 });
await call("sketchpad_draw", { points: [{ x: 380, y: 600 }, { x: 372, y: 572 }, { x: 388, y: 572 }, { x: 380, y: 600 }], color: BLUE, size: 3 });

console.log(await call("sketchpad_screenshot", { maxWidth: 900 }).then((s) => s.slice(0, 120)));
console.log(await call("sketchpad_save", { path: DIR + "\\sketchpad-out\\motor.png" }));
process.exit(0);
