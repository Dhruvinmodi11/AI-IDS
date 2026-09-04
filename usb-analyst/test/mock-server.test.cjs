const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const T = require("../dashboard/agent-lib.js");

const PORT = 18050;
const ROOT = path.join(__dirname, "..");

function parseSseText(raw) {
  let text = "";
  for (const line of String(raw).split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const payload = s.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload);
      text += j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
    } catch {}
  }
  return text;
}

function req(pathname, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      path: pathname,
      method,
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "mock-server.cjs")], {
    env: { ...process.env, PORT: String(PORT), REPORTS_DIR: "/tmp/usb-analyst-reports" },
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock server did not start")), 8000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("Mock Local Analyst")) { clearTimeout(t); resolve(); }
    });
    child.on("error", reject);
  });

  try {
    const health = await req("/health");
    assert.strictEqual(health.status, 200);

    const listed = JSON.parse((await req("/api/tools", {
      method: "POST",
      body: JSON.stringify({ name: "list_files", arguments: { folder: "data" } }),
    })).text);
    assert.ok(listed.ok);
    assert.ok(listed.files.some((f) => f.name === "01_shop_small.csv"));

    const dash = await req("/");
    assert.ok(dash.text.includes("agent-lib.js"));

    const first = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "What files are in my USB data folder?" }] }),
    });
    const firstText = parseSseText(first.text);
    const calls = T.extractToolCalls(firstText, null);
    assert.strictEqual(calls[0].name, "list_files");

    const tool = JSON.parse((await req("/api/tools", {
      method: "POST",
      body: JSON.stringify({ name: calls[0].name, arguments: calls[0].arguments }),
    })).text);
    const second = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "What files are in my USB data folder?" },
          { role: "assistant", content: firstText },
          { role: "user", content: "TOOL_RESULT list_files:\n" + JSON.stringify(tool) },
        ],
      }),
    });
    assert.ok(/files/i.test(parseSseText(second.text)), second.text);

    const profile = JSON.parse((await req("/api/tools", {
      method: "POST",
      body: JSON.stringify({ name: "profile_table", arguments: { path: "01_shop_small.csv" } }),
    })).text);
    assert.ok(profile.metrics.some((m) => String(m).includes("sum=330")), profile.metrics);

    const written = JSON.parse((await req("/api/tools", {
      method: "POST",
      body: JSON.stringify({ name: "write_report", arguments: { filename: "shop-note.md", content: "GMP note 330" } }),
    })).text);
    assert.strictEqual(written.ok, true);

    const blocked = JSON.parse((await req("/api/tools", {
      method: "POST",
      body: JSON.stringify({ name: "read_file", arguments: { path: "../Start-Analyst.ps1" } }),
    })).text);
    assert.strictEqual(blocked.ok, false);

    console.log("mock-server integration tests passed");
  } finally {
    child.kill();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
