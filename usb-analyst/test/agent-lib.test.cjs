const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../dashboard/agent-lib.js");

const shop = fs.readFileSync(path.join(__dirname, "../data/01_shop_small.csv"), "utf8");
const spend = fs.readFileSync(path.join(__dirname, "../data/02_monthly_spend.csv"), "utf8");

function tableFromCsv(text) {
  const grid = T.parseCSV(text, ",");
  const columns = grid[0].map((h, i) => String(h).trim() || "col_" + (i + 1));
  const records = grid.slice(1).map((r) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = r[i] == null ? "" : String(r[i]).trim(); });
    return o;
  });
  return { columns, records };
}

const shopT = tableFromCsv(shop);
assert.strictEqual(shopT.records.length, 4);
const shopMetrics = T.profileTable(shopT.columns, shopT.records);
const line = shopMetrics.find((m) => m.startsWith("line_total:"));
assert.ok(line.includes("sum=330"), line);
assert.ok(shopMetrics.some((m) => m.includes("eggs(1)") || m.includes("eggs")), shopMetrics.join(" | "));

const spendT = tableFromCsv(spend);
const spendMetrics = T.profileTable(spendT.columns, spendT.records);
const amt = spendMetrics.find((m) => m.startsWith("amount:"));
assert.ok(amt.includes("sum=12108"), amt);
assert.ok(amt.includes("max=8000"), amt);

const xml = T.extractToolCalls('<tool>{"name":"list_files","arguments":{"folder":"data"}}</tool>', null);
assert.strictEqual(xml.length, 1);
assert.strictEqual(xml[0].name, "list_files");
assert.strictEqual(xml[0].arguments.folder, "data");

const mixed = T.extractToolCalls('Sure.\nTOOL: profile_table\nARGS: {"path":"01_shop_small.csv"}\n', null);
assert.strictEqual(mixed[0].name, "profile_table");
assert.strictEqual(mixed[0].arguments.path, "01_shop_small.csv");

const native = T.extractToolCalls("", [
  { id: "1", function: { name: "write_report", arguments: "{\"filename\":\"note.md\",\"content\":\"ok\"}" } },
]);
assert.strictEqual(native[0].name, "write_report");
assert.strictEqual(native[0].arguments.filename, "note.md");

const stripped = T.stripToolMarkup('Hello\n<tool>{"name":"list_files","arguments":{}}</tool>\n');
assert.strictEqual(stripped, "Hello");

const dup = T.extractToolCalls('<tool>{"name":"list_files","arguments":{}}</tool><tool>{"name":"list_files","arguments":{}}</tool>', null);
assert.strictEqual(dup.length, 1);

const unknown = T.extractToolCalls('<tool>{"name":"rm","arguments":{"path":"C:\\\\Windows"}}</tool>', null);
assert.strictEqual(unknown.length, 0);

const cased = T.extractToolCalls('<tool>{"name":"List_Files","arguments":{}}</tool>', null);
assert.strictEqual(cased[0].name, "list_files");

assert.ok(T.systemPrompt().includes("profile_table"));
assert.ok(T.OPENAI_TOOLS.length === 5);

console.log("agent-lib tests passed");
