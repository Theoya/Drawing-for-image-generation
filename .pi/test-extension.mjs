// Load .pi/extensions/sketchpad.ts through PI's real extension loader
// (dist/core/extensions/loader.js) and exercise the registered tools
// against the live app on 127.0.0.1:8391.
const PI_LOADER = "file:///C:/Users/THadfield/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
const { loadExtensions } = await import(PI_LOADER);

const CWD = "C:\\Users\\THadfield\\Drawing for image generation";
const EXT = "C:\\Users\\THadfield\\Drawing for image generation\\.pi\\extensions\\sketchpad.ts";

const { extensions, errors } = await loadExtensions([EXT], CWD);
if (errors.length) {
  console.error("LOAD FAILED:", errors[0].error);
  process.exit(1);
}
if (!extensions.length) { console.error("NO EXTENSION LOADED"); process.exit(1); }
const extension = extensions[0];
console.log("LOADED OK — extension keys:", Object.keys(extension));
const tools = extension.tools instanceof Map ? [...extension.tools.values()] : extension.tools;
const names = tools.map((t) => t.name ?? t.definition?.name);
console.log("tools:", names.join(", "));

async function call(name, params) {
  const t = tools.find((x) => (x.name ?? x.definition?.name) === name);
  if (!t) throw new Error("tool not found: " + name);
  try {
    const res = await t.definition.execute("test-1", params, new AbortController().signal);
    const text = (res.content || [])
      .map((c) => (c.type === "text" ? c.text : `[image ${c.mimeType}, ${(c.data.length / 1024).toFixed(0)}KB]`))
      .join(" | ");
    console.log(`\n== ${name}(${JSON.stringify(params)}) ==\n${text.slice(0, 700)}`);
    return res;
  } catch (err) {
    console.log(`\n== ${name}(${JSON.stringify(params)}) == ERROR: ${err.message}`);
    throw err;
  }
}

const what = process.argv[2] || "smoke";
if (what === "smoke") {
  await call("sketchpad_app", { action: "status" });
  await call("sketchpad_state", {});
  await call("sketchpad_draw", {
    points: [
      { x: 200, y: 200, p: 0.3 }, { x: 300, y: 150, p: 0.7 }, { x: 400, y: 200, p: 0.4 },
      { x: 350, y: 300, p: 0.9 }, { x: 250, y: 300, p: 0.3 },
    ],
    color: "#46a758", size: 14,
  });
  await call("sketchpad_screenshot", { maxWidth: 400 });
  console.log("\nSMOKE OK");
} else if (what === "flip") {
  await call("sketchpad_flip", {});
  await call("sketchpad_flip", {});
  console.log("\nFLIP ROUND-TRIP OK");
}
process.exit(0);
