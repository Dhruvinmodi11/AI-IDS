#!/usr/bin/env node
/* Local mock of the USB dashboard APIs so the agent UI can be exercised without Windows/GPU. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const T = require("../dashboard/agent-lib.js");

const ROOT = path.join(__dirname, "..");
const DASH = path.join(ROOT, "dashboard");
const DATA = path.join(ROOT, "data");
const REPORTS = process.env.REPORTS_DIR || path.join("/tmp", "usb-analyst-reports");
const PORT = Number(process.env.PORT || 8050);

fs.mkdirSync(REPORTS, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(res, code, type, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": buf.length });
  res.end(buf);
}

function sendJson(res, obj, code = 200) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
}

function listFiles(folder) {
  const dirs = [];
  if (folder === "data" || folder === "all" || !folder) dirs.push({ name: "data", dir: DATA });
  if (folder === "reports" || folder === "all" || !folder) dirs.push({ name: "reports", dir: REPORTS });
  const files = [];
  for (const d of dirs) {
    if (!fs.existsSync(d.dir)) continue;
    for (const name of fs.readdirSync(d.dir)) {
      const full = path.join(d.dir, name);
      if (!fs.statSync(full).isFile() || name === ".gitkeep") continue;
      files.push({ name, path: d.name + "/" + name, folder: d.name, bytes: fs.statSync(full).size });
    }
  }
  return files;
}

function resolveFile(rel) {
  const raw = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..") || raw.includes(":")) throw new Error("path not allowed");
  const parts = raw.split("/");
  let folder = "data";
  let rest = raw;
  if (parts[0] === "data" || parts[0] === "reports") {
    folder = parts[0];
    rest = parts.slice(1).join("/");
  }
  const base = folder === "reports" ? REPORTS : DATA;
  const full = path.join(base, rest);
  if (!full.startsWith(base) || !fs.existsSync(full)) throw new Error("file not found: " + rel);
  return { full, rel: folder + "/" + rest };
}

function invokeTool(name, args) {
  args = args || {};
  if (name === "list_files") return { ok: true, folder: args.folder || "all", files: listFiles(args.folder || "all") };
  if (name === "read_file") {
    const { full, rel } = resolveFile(args.path || args.filename);
    const content = fs.readFileSync(full, "utf8");
    return { ok: true, path: rel, bytes: Buffer.byteLength(content), content };
  }
  if (name === "profile_table") {
    const { full, rel } = resolveFile(args.path || args.filename);
    const text = fs.readFileSync(full, "utf8");
    const sep = rel.endsWith(".tsv") ? "\t" : ",";
    const grid = T.parseCSV(text, sep);
    const columns = grid[0].map((h, i) => String(h).trim() || "col_" + (i + 1));
    const records = grid.slice(1).map((r) => {
      const o = {};
      columns.forEach((c, i) => { o[c] = r[i] == null ? "" : String(r[i]).trim(); });
      return o;
    });
    return {
      ok: true,
      path: rel,
      rows: records.length,
      columns,
      metrics: T.profileTable(columns, records),
      sample: records.slice(0, 20),
    };
  }
  if (name === "search_files") {
    const matches = [];
    const q = String(args.query || "");
    if (!q) throw new Error("query required");
    for (const f of listFiles(args.folder || "all")) {
      const text = fs.readFileSync(resolveFile(f.path).full, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.toLowerCase().includes(q.toLowerCase()) && matches.length < 40) {
          matches.push({ path: f.path, line: i + 1, text: line.slice(0, 240) });
        }
      });
    }
    return { ok: true, query: q, matches };
  }
  if (name === "write_report") {
    const filename = path.basename(String(args.filename || ""));
    if (!/^[\w.\- ]+\.(md|txt|csv|json)$/.test(filename)) throw new Error("filename must be a simple .md/.txt/.csv/.json name");
    fs.writeFileSync(path.join(REPORTS, filename), String(args.content || ""), "utf8");
    return { ok: true, filename, path: "reports/" + filename, bytes: Buffer.byteLength(String(args.content || "")) };
  }
  throw new Error("unknown tool: " + name);
}

function nextReply(messages) {
  const last = messages[messages.length - 1] || {};
  const text = String(last.content || "");
  if (text.startsWith("TOOL_RESULT")) {
    if (/write_report/.test(text)) return "Saved the note under reports on the USB stick.";
    if (/profile_table|sum=/.test(text)) {
      return "Authoritative metrics from the tool: use the sums it reported (shop line_total is 330 if that file was profiled). Eggs is the highest shop line. This is an operations note, not a CDSCO filing.";
    }
    if (/list_files|"files"/.test(text)) return "Those are the files on the USB data/reports folders. I can profile any CSV next.";
    return "Tool finished. Tell me what you want next.";
  }
  const blob = messages.map((m) => String(m.content || "")).join("\n").toLowerCase();
  if (blob.includes("write") && blob.includes("report")) {
    return '<tool>{"name":"write_report","arguments":{"filename":"shop-note.md","content":"GMP note: shop line_total 330 (tool). Not a CDSCO filing."}}</tool>';
  }
  const m = blob.match(/0\d_[a-z0-9_]+\.csv/);
  if (blob.includes("profile") || blob.includes("total") || blob.includes("csv") || m) {
    const p = m ? m[0] : "01_shop_small.csv";
    return `<tool>{"name":"profile_table","arguments":{"path":"${p}"}}</tool>`;
  }
  return '<tool>{"name":"list_files","arguments":{"folder":"data"}}</tool>';
}

function streamCompletion(res, text) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  res.write("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n");
  res.write("data: [DONE]\n\n");
  res.end();
}

let chats = [];
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let p = url.pathname;
    if (p === "/") p = "/index.html";
    if (p === "/health") return send(res, 200, "text/plain", "ok");
    if (p === "/api/status") {
      return sendJson(res, { ok: true, model: "mock-agent", tools: T.TOOL_NAMES, files: listFiles("all") });
    }
    if (p === "/api/chats") {
      if (req.method === "GET") return sendJson(res, chats);
      const body = await readBody(req);
      chats = JSON.parse(body || "[]");
      return sendJson(res, { ok: true });
    }
    if (p === "/api/tools" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      try {
        return sendJson(res, invokeTool(String(body.name || "").toLowerCase(), body.arguments || body.args || {}));
      } catch (err) {
        return sendJson(res, { ok: false, error: String(err.message || err) });
      }
    }
    if (p === "/v1/chat/completions" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      return streamCompletion(res, nextReply(body.messages || []));
    }
    const rel = path.normalize(p.replace(/^\/+/, "")).replace(/^\.\.[/\\].*/, "");
    const file = path.join(DASH, rel);
    if (!file.startsWith(DASH) || !fs.existsSync(file)) return send(res, 404, "text/plain", "not found");
    send(res, 200, MIME[path.extname(file)] || "application/octet-stream", fs.readFileSync(file));
  } catch (err) {
    send(res, 500, "text/plain", String(err.message || err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Mock Local Analyst on http://127.0.0.1:" + PORT);
});
