(() => {
  const API = location.protocol === "file:" ? "http://127.0.0.1:8091" : "";

  const $ = (id) => document.getElementById(id);
  const input = $("input");
  const thread = $("thread");
  const welcome = $("welcome");
  const chips = $("chips");
  const sendBtn = $("sendBtn");
  const composer = $("composer");
  const engineStatus = $("engineStatus");

  let engine = false;
  let busy = false;
  let attachments = [];
  let chats = [];
  let currentId = null;

  function uid() { return Math.random().toString(36).slice(2, 10); }
  async function loadChatsFromUsb() {
    try {
      const r = await fetch("/api/chats", { cache: "no-store" });
      chats = await r.json();
      if (!Array.isArray(chats)) chats = [];
    } catch { chats = []; }
    if (!chats.length) newChat(true);
    else currentId = chats[0].id;
  }
  function saveChats() {
    fetch("/api/chats", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chats),
    }).catch(() => {});
  }
  function current() { return chats.find((c) => c.id === currentId); }
  function newChat(select = true) {
    const c = { id: uid(), title: "New chat", messages: [], created: Date.now() };
    chats.unshift(c);
    if (select) currentId = c.id;
    saveChats();
    return c;
  }

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
    const src = text.replace(/^\uFEFF/, "");
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
      const vals = records.map((r) => r[c]).filter((v) => v !== "");
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

  function fileToAttachment(file, text) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      throw new Error("Save the Excel file as CSV first, then attach that.");
    }
    let columns = [], records = [], kind = "text";
    if (name.endsWith(".json")) {
      let data = JSON.parse(text);
      if (data && Array.isArray(data.data)) data = data.data;
      if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
        columns = Object.keys(data[0]);
        records = data.map((row) => {
          const o = {};
          columns.forEach((c) => { o[c] = row[c] == null ? "" : String(row[c]); });
          return o;
        });
        kind = "table";
      }
    } else if (name.endsWith(".csv") || name.endsWith(".tsv") || text.includes(",") || text.includes("\t")) {
      const sep = name.endsWith(".tsv") || (text.split("\t").length > text.split(",").length * 2) ? "\t" : ",";
      const grid = parseCSV(text, sep);
      if (grid.length >= 2) {
        columns = grid[0].map((h, i) => String(h).trim() || "col_" + (i + 1));
        records = grid.slice(1).map((r) => {
          const o = {};
          columns.forEach((c, i) => { o[c] = r[i] == null ? "" : String(r[i]).trim(); });
          return o;
        });
        kind = "table";
      }
    }
    const sample = kind === "table"
      ? [columns.join(","), ...records.slice(0, 40).map((r) => columns.map((c) => r[c]).join(","))].join("\n")
      : text.slice(0, 12000);
    const metrics = kind === "table" ? profileTable(columns, records) : [];
    const context = kind === "table"
      ? `Attached table ${file.name} (${records.length} rows).\nAuthoritative metrics (already computed; do not recalculate):\n- ${metrics.join("\n- ")}\nSample:\n${sample}`
      : `Attached file ${file.name}:\n${sample}`;
    return { name: file.name, kind, columns, records, metrics, context };
  }

  function md(text) {
    const esc = String(text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc
      .replace(/```([\s\S]*?)```/g, "<pre>$1</pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
      .replace(/\n/g, "<br>");
  }

  function renderNav() {
    const nav = $("chatNav");
    nav.innerHTML = "";
    chats.forEach((c) => {
      const b = document.createElement("button");
      b.textContent = c.title || "New chat";
      if (c.id === currentId) b.className = "active";
      b.onclick = () => { currentId = c.id; renderThread(); renderNav(); };
      nav.appendChild(b);
    });
  }

  function renderChips() {
    chips.innerHTML = "";
    attachments.forEach((a, i) => {
      const el = document.createElement("div");
      el.className = "chip";
      el.innerHTML = `<span>${a.name}${a.kind === "table" ? " · " + a.records.length + " rows" : ""}</span>`;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.onclick = () => { attachments.splice(i, 1); renderChips(); renderStats(); };
      el.appendChild(x);
      chips.appendChild(el);
    });
  }

  function renderStats() {
    thread.querySelectorAll(".stats, .table-mini").forEach((n) => n.remove());
    const table = attachments.find((a) => a.kind === "table");
    if (!table || !current().messages.length) return;
    const stats = document.createElement("div");
    stats.className = "stats";
    const cards = [{ label: "Rows", value: table.records.length }, { label: "Columns", value: table.columns.length }];
    table.metrics.slice(0, 3).forEach((m) => {
      const sum = m.match(/sum=([^,]+)/);
      cards.push({ label: m.split(":")[0], value: sum ? sum[1] : "—" });
    });
    cards.forEach((c) => {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<span>${c.label}</span><b>${c.value}</b>`;
      stats.appendChild(d);
    });
    const mini = document.createElement("div");
    mini.className = "table-mini";
    const cols = table.columns;
    const rows = table.records.slice(0, 8);
    mini.innerHTML = "<table><thead><tr>" + cols.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + cols.map((c) => "<td>" + String(r[c]).replace(/</g, "&lt;") + "</td>").join("") + "</tr>").join("") +
      "</tbody></table>";
    const first = thread.querySelector(".msg, .user-wrap");
    if (first) {
      thread.insertBefore(mini, first);
      thread.insertBefore(stats, mini);
    }
  }

  function renderThread() {
    const c = current();
    const has = c.messages.length > 0;
    welcome.classList.toggle("hidden", has);
    thread.classList.toggle("hidden", !has);
    thread.innerHTML = "";
    c.messages.forEach((m) => {
      if (m.role === "user") {
        const wrap = document.createElement("div");
        wrap.className = "user-wrap";
        wrap.innerHTML = `<div class="user-bubble">${md(m.content)}</div>`;
        thread.appendChild(wrap);
      } else {
        const wrap = document.createElement("div");
        wrap.className = "msg assistant";
        wrap.innerHTML = `<div class="avatar">LA</div><div class="bubble">${md(m.content)}</div>`;
        thread.appendChild(wrap);
      }
    });
    renderStats();
    thread.scrollTop = thread.scrollHeight;
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  function systemPrompt() {
    return [
      "You are Local Analyst, a helpful chatbot running fully offline on the user's computer.",
      "Talk naturally, like ChatGPT: warm, clear, concise. You can chat about anything.",
      "If the user did not attach a file, do NOT say the dataset is empty and do NOT demand a spreadsheet. Just answer.",
      "When files ARE attached, use them. Lines labelled Authoritative metrics are already computed — use those numbers; do not invent totals.",
      "Never write Python, pandas, or tool_code. Never claim you opened a disk path yourself.",
    ].join(" ");
  }

  async function streamChat(messages, onDelta) {
    const res = await fetch(API + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0.7, max_tokens: 900, stream: true }),
    });
    if (!res.ok) throw new Error("Model HTTP " + res.status);
    if (!res.body) {
      const data = await res.json();
      const t = data.choices?.[0]?.message?.content || "";
      onDelta(t);
      return t;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
          if (d) { full += d; onDelta(full); }
        } catch {}
      }
    }
    return full;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (!engine) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    autoGrow();

    const c = current();
    if (c.messages.length === 0) c.title = text.slice(0, 42);
    c.messages.push({ role: "user", content: text });
    saveChats();
    renderNav();
    renderThread();

    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    wrap.innerHTML = `<div class="avatar">LA</div><div class="bubble"><span class="cursor"></span></div>`;
    thread.appendChild(wrap);
    const bubble = wrap.querySelector(".bubble");
    thread.scrollTop = thread.scrollHeight;

    const apiMessages = [{ role: "system", content: systemPrompt() }];
    if (attachments.length) {
      apiMessages.push({
        role: "user",
        content: attachments.map((a) => a.context).join("\n\n"),
      });
      apiMessages.push({
        role: "assistant",
        content: "I've got the attached file(s). I'll use them when relevant and chat normally otherwise.",
      });
    }
    c.messages.forEach((m) => apiMessages.push({ role: m.role, content: m.content }));

    try {
      const full = await streamChat(apiMessages, (t) => {
        bubble.innerHTML = md(t) + '<span class="cursor"></span>';
        thread.scrollTop = thread.scrollHeight;
      });
      bubble.innerHTML = md(full || "I couldn't generate a reply.");
      c.messages.push({ role: "assistant", content: full || "" });
      saveChats();
    } catch (err) {
      bubble.textContent = String(err.message || err);
    }
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  async function addFiles(list) {
    for (const file of list) {
      try {
        const att = fileToAttachment(file, await file.text());
        attachments = attachments.filter((a) => a.name !== att.name).concat(att);
      } catch (err) {
        const c = current();
        c.messages.push({ role: "assistant", content: String(err.message || err) });
        saveChats();
      }
    }
    renderChips();
    if (current().messages.length) renderThread();
  }

  $("newChat").onclick = () => {
    newChat(true);
    attachments = [];
    renderChips();
    renderNav();
    renderThread();
    input.focus();
  };
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("fileInput").addEventListener("change", (e) => addFiles(e.target.files));

  ["dragenter", "dragover"].forEach((ev) => {
    window.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach((ev) => {
    window.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.remove("over"); });
  });
  window.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  async function ping() {
    try {
      const res = await fetch(API + "/health", { cache: "no-store" });
      if (!res.ok) throw new Error("down");
      engine = true;
      engineStatus.className = "pill ok";
      engineStatus.textContent = "Online";
      sendBtn.disabled = busy;
    } catch {
      engine = false;
      engineStatus.className = "pill wait";
      engineStatus.textContent = "Starting model…";
      sendBtn.disabled = true;
    }
  }

  loadChatsFromUsb().then(() => {
    renderNav();
    renderThread();
    input.focus();
  });
  ping();
  setInterval(ping, 4000);
})();
