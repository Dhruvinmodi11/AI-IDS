/* Shared CSV / tool-call helpers. Loaded by the dashboard and by node tests. */
(function (root) {
  const TOOL_NAMES = ["list_files", "read_file", "profile_table", "search_files", "write_report"];

  const OPENAI_TOOLS = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List CSV/text files on the USB stick in data/ and reports/.",
        parameters: {
          type: "object",
          properties: {
            folder: { type: "string", enum: ["data", "reports", "all"], description: "Which folder to list. Default all." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a text/CSV/JSON file from data/ or reports/. Prefer profile_table for spreadsheets.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Filename or data/name.csv" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "profile_table",
        description: "Compute authoritative row counts, sums, means, min/max, and top categories for a CSV/TSV/JSON table. Use these numbers; do not recalculate.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Filename or data/name.csv" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "Search for a string across USB data/ and reports/ text files.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            folder: { type: "string", enum: ["data", "reports", "all"] },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_report",
        description: "Save a markdown/text report onto the USB stick under reports/.",
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string", description: "Simple name like batch-note.md" },
            content: { type: "string" },
          },
          required: ["filename", "content"],
        },
      },
    },
  ];

  function looksNumber(v) {
    const t = String(v).replace(/[,₹$%\s]/g, "");
    return t !== "" && !Number.isNaN(Number(t));
  }

  function toNumber(v) {
    const n = Number(String(v).replace(/[,₹$%\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  }

  function parseCSV(text, sep) {
    const rows = [];
    let row = [], cell = "", q = false;
    const src = String(text).replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }

  function profileTable(columns, records) {
    const stats = [];
    for (const c of columns) {
      const vals = records.map((r) => r[c]).filter((v) => v !== "" && v != null);
      const nums = vals.map(toNumber).filter((n) => n != null);
      if (vals.length && nums.length / vals.length > 0.7) {
        const sum = nums.reduce((a, b) => a + b, 0);
        stats.push(`${c}: sum=${sum}, mean=${sum / nums.length}, min=${Math.min(...nums)}, max=${Math.max(...nums)}, n=${nums.length}`);
      } else {
        const counts = {};
        vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map((x) => x[0] + "(" + x[1] + ")").join(", ");
        stats.push(`${c}: unique=${Object.keys(counts).length}, top=${top}`);
      }
    }
    return stats;
  }

  function parseMaybeJson(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  }

  function asCall(name, args, id) {
    name = String(name || "").trim().toLowerCase();
    if (!name || TOOL_NAMES.indexOf(name) < 0) return null;
    return { id: id || ("call_" + Math.random().toString(36).slice(2, 10)), name, arguments: args && typeof args === "object" ? args : {} };
  }

  function extractFromNative(native) {
    const calls = [];
    const list = native && (native.tool_calls || native);
    if (!Array.isArray(list)) return calls;
    for (const t of list) {
      if (!t) continue;
      const fn = t.function || t;
      let args = fn.arguments;
      if (typeof args === "string") {
        const parsed = parseMaybeJson(args);
        args = parsed && typeof parsed === "object" ? parsed : {};
      }
      const call = asCall(fn.name || t.name, args || {}, t.id);
      if (call) calls.push(call);
    }
    return calls;
  }

  function extractToolCalls(text, native) {
    const calls = extractFromNative(native);
    const src = String(text || "");

    const xml = /<tool(?:_call)?>\s*([\s\S]*?)\s*<\/tool(?:_call)?>/gi;
    let m;
    while ((m = xml.exec(src))) {
      const j = parseMaybeJson(m[1]);
      const call = j && asCall(j.name, j.arguments || j.args || {}, j.id);
      if (call) calls.push(call);
    }

    const line = /TOOL:\s*([a-z_]+)\s*(?:\n|\r\n)ARGS:\s*(\{[\s\S]*?\})/gi;
    while ((m = line.exec(src))) {
      const call = asCall(m[1], parseMaybeJson(m[2]) || {}, null);
      if (call) calls.push(call);
    }

    const fence = /```(?:json|tool)?\s*(\{[\s\S]*?"name"\s*:\s*"(?:list_files|read_file|profile_table|search_files|write_report)"[\s\S]*?\})\s*```/gi;
    while ((m = fence.exec(src))) {
      const j = parseMaybeJson(m[1]);
      const call = j && asCall(j.name, j.arguments || j.args || {}, j.id);
      if (call) calls.push(call);
    }

    const seen = {};
    return calls.filter((c) => {
      const key = c.name + JSON.stringify(c.arguments);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function stripToolMarkup(text) {
    return String(text || "")
      .replace(/<tool(?:_call)?>[\s\S]*?<\/tool(?:_call)?>/gi, "")
      .replace(/TOOL:\s*[a-z_]+\s*(?:\n|\r\n)ARGS:\s*\{[\s\S]*?\}/gi, "")
      .replace(/```(?:json|tool)?\s*\{[\s\S]*?"name"\s*:\s*"(?:list_files|read_file|profile_table|search_files|write_report)"[\s\S]*?\}\s*```/gi, "")
      .trim();
  }

  function systemPrompt() {
    return [
      "You are Local Analyst, a pharmaceutical operations assistant running fully offline from a USB stick for an Indian pharma company.",
      "You have tools that can list, read, profile, search, and write files in data/ and reports/ on the stick. You cannot see the rest of the PC.",
      "Talk naturally, like ChatGPT. If the user is just chatting, answer — do not demand a spreadsheet.",
      "When the user asks about files, totals, batches, PV lists, or anything on the stick: call tools before answering. Do not invent row counts, yields, AE counts, or rupee totals.",
      "profile_table returns authoritative metrics. Copy those numbers; never recalculate. Prefer profile_table over dumping a whole CSV with read_file.",
      "To call a tool, output ONLY this XML (you may call one tool per turn):",
      "<tool>{\"name\":\"list_files\",\"arguments\":{\"folder\":\"data\"}}</tool>",
      "After a TOOL_RESULT arrives, either call another tool the same way or give the user the final answer. Do not mention the XML tags in the final answer.",
      "You may use CDSCO, Schedule M, GMP, pharmacovigilance, CTRI, and IPC language. You are not a doctor and not a CDSCO filing system. No patient-specific treatment. Flag that regulatory decisions need a qualified person.",
      "If a file looks like identifiable patient or employee data, summarise aggregates only (DPDP).",
      "Never write Python, pandas, or tool_code. Never claim you opened C: or arbitrary disk paths. Tools only reach data/ and reports/.",
    ].join(" ");
  }

  function asList(v) {
    if (v == null || v === "") return [];
    return Array.isArray(v) ? v : [v];
  }

  function toolSummary(name, result) {
    if (!result) return name;
    if (result.ok === false) return name + " failed: " + (result.error || "error");
    if (name === "list_files") {
      const n = asList(result.files).length;
      return "Listed " + n + " file" + (n === 1 ? "" : "s");
    }
    if (name === "read_file") return "Read " + (result.path || "file");
    if (name === "profile_table") {
      const rows = result.rows != null ? result.rows + " rows" : "table";
      return "Profiled " + (result.path || "table") + " · " + rows;
    }
    if (name === "search_files") {
      const n = asList(result.matches).length;
      return "Search: " + n + " match" + (n === 1 ? "" : "es");
    }
    if (name === "write_report") return "Saved reports/" + (result.filename || "report");
    return name;
  }

  const api = {
    TOOL_NAMES,
    OPENAI_TOOLS,
    looksNumber,
    toNumber,
    parseCSV,
    profileTable,
    extractToolCalls,
    stripToolMarkup,
    systemPrompt,
    toolSummary,
    asList,
  };

  root.AnalystTools = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
