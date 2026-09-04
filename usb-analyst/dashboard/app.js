(() => {
  const API = location.protocol === "file:" ? "http://127.0.0.1:8091" : "";
  const T = window.AnalystTools;
  const MAX_STEPS = 8;

  const $ = (id) => document.getElementById(id);
  const input = $("input");
  const thread = $("thread");
  const welcome = $("welcome");
  const chips = $("chips");
  const sendBtn = $("sendBtn");
  const composer = $("composer");
  const engineStatus = $("engineStatus");
  const modelNameEl = $("modelName");

  let engine = false;
  let busy = false;
  let attachments = [];
  let chats = [];
  let currentId = null;
  let nativeToolsOk = true;

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
      const grid = T.parseCSV(text, sep);
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
    const metrics = kind === "table" ? T.profileTable(columns, records) : [];
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
      x.onclick = () => { attachments.splice(i, 1); renderChips(); renderThread(); };
      el.appendChild(x);
      chips.appendChild(el);
    });
  }

  function tracesHtml(traces) {
    if (!traces || !traces.length) return "";
    return `<div class="traces">${traces.map((t) =>
      `<span class="trace ${t.ok === false ? "bad" : t.wait ? "wait" : "ok"}">${t.summary || t.name}</span>`
    ).join("")}</div>`;
  }

  function renderStats(into) {
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
    into.appendChild(stats);
    into.appendChild(mini);
  }

  function renderThread() {
    const c = current();
    const has = c.messages.length > 0;
    welcome.classList.toggle("hidden", has);
    thread.classList.toggle("hidden", !has);
    thread.innerHTML = "";
    if (has) renderStats(thread);
    c.messages.forEach((m) => {
      if (m.traces && m.traces.length) {
        const box = document.createElement("div");
        box.innerHTML = tracesHtml(m.traces);
        thread.appendChild(box.firstChild);
      }
      if (m.role === "user") {
        const wrap = document.createElement("div");
        wrap.className = "user-wrap";
        wrap.innerHTML = `<div class="user-bubble">${md(m.content)}</div>`;
        thread.appendChild(wrap);
      } else if (m.content) {
        const wrap = document.createElement("div");
        wrap.className = "msg assistant";
        wrap.innerHTML = `<div class="avatar">LA</div><div class="bubble">${md(m.content)}</div>`;
        thread.appendChild(wrap);
      }
    });
    thread.scrollTop = thread.scrollHeight;
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  function attachmentPrelude() {
    if (!attachments.length) return "";
    return attachments.map((a) => a.context).join("\n\n");
  }

  async function callTool(name, args) {
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args || {} }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "bad tool response" }));
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  }

  function formatToolResult(name, result) {
    try {
      if (name === "read_file" && result && result.content && result.content.length > 8000) {
        const copy = Object.assign({}, result, { content: result.content.slice(0, 8000) + "\n… [truncated; use profile_table for CSVs]" });
        return JSON.stringify(copy);
      }
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  async function completeChat(messages, { onDelta, useNativeTools }) {
    const body = {
      messages,
      temperature: 0.35,
      max_tokens: 1000,
      stream: true,
      cache_prompt: true,
    };
    if (useNativeTools) {
      body.tools = T.OPENAI_TOOLS;
      body.tool_choice = "auto";
    }
    const res = await fetch(API + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 400 && useNativeTools) {
      nativeToolsOk = false;
      return completeChat(messages, { onDelta, useNativeTools: false });
    }
    if (!res.ok) throw new Error("Model HTTP " + res.status);
    const toolAcc = [];
    let text = "";
    let finish = "";

    function takeDelta(j) {
      const choice = j.choices && j.choices[0];
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      const msg = choice.message || {};
      const piece = delta.content || msg.content || "";
      if (piece) {
        text += piece;
        if (onDelta) onDelta(T.stripToolMarkup(text) || text);
      }
      const tcs = delta.tool_calls || msg.tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const i = tc.index != null ? tc.index : toolAcc.length;
          if (!toolAcc[i]) toolAcc[i] = { id: tc.id || "", name: "", arguments: "" };
          if (tc.id) toolAcc[i].id = tc.id;
          const fn = tc.function || {};
          if (fn.name) toolAcc[i].name = fn.name;
          if (fn.arguments) toolAcc[i].arguments += fn.arguments;
        }
      }
    }

    if (!res.body) {
      const data = await res.json();
      takeDelta(data);
      return { text, tool_calls: toolAcc.filter(Boolean), finish_reason: finish };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
        try { takeDelta(JSON.parse(payload)); } catch {}
      }
    }
    return { text, tool_calls: toolAcc.filter(Boolean), finish_reason: finish };
  }

  function showLiveTraces(traces) {
    thread.querySelectorAll(".traces.live").forEach((n) => n.remove());
    if (!traces.length) return;
    const box = document.createElement("div");
    box.innerHTML = tracesHtml(traces);
    const el = box.firstChild;
    el.classList.add("live");
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
  }

  async function send(preset) {
    const text = (preset || input.value).trim();
    if (!text || busy) return;
    if (!engine) return;
    busy = true;
    sendBtn.disabled = true;
    if (!preset) input.value = "";
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

    const apiMessages = [{ role: "system", content: T.systemPrompt() }];
    const attached = attachmentPrelude();
    if (attached) {
      apiMessages.push({ role: "user", content: attached });
      apiMessages.push({
        role: "assistant",
        content: "I have the attached file metrics. I will use tools for anything on the USB data/reports folders.",
      });
    }
    c.messages.forEach((m) => {
      if (m.role === "user" || m.role === "assistant") {
        apiMessages.push({ role: m.role, content: m.content || "" });
      }
    });

    const traces = [];
    let finalText = "";
    let usedNative = false;

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const result = await completeChat(apiMessages, {
          useNativeTools: nativeToolsOk,
          onDelta: (t) => {
            bubble.innerHTML = md(t || "…") + '<span class="cursor"></span>';
            thread.scrollTop = thread.scrollHeight;
          },
        });
        const nativeCalls = T.extractToolCalls("", result.tool_calls);
        const textCalls = T.extractToolCalls(result.text, null);
        const calls = nativeCalls.length ? nativeCalls : textCalls;
        usedNative = usedNative || nativeCalls.length > 0;

        if (!calls.length) {
          finalText = T.stripToolMarkup(result.text) || result.text || "";
          break;
        }

        if (usedNative && nativeCalls.length) {
          apiMessages.push({
            role: "assistant",
            content: result.text || "",
            tool_calls: nativeCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
            })),
          });
        } else {
          apiMessages.push({
            role: "assistant",
            content: result.text || `<tool>${JSON.stringify({ name: calls[0].name, arguments: calls[0].arguments || {} })}</tool>`,
          });
        }

        bubble.innerHTML = '<span class="cursor"></span>';
        for (const call of calls) {
          traces.push({ name: call.name, wait: true, summary: "Running " + call.name + "…" });
          showLiveTraces(traces);
          const out = await callTool(call.name, call.arguments);
          traces.pop();
          traces.push({
            name: call.name,
            ok: out.ok !== false,
            summary: T.toolSummary(call.name, out),
          });
          showLiveTraces(traces);
          const payload = "TOOL_RESULT " + call.name + ":\n" + formatToolResult(call.name, out);
          if (usedNative && nativeCalls.length) {
            apiMessages.push({ role: "tool", tool_call_id: call.id, content: payload });
          } else {
            apiMessages.push({ role: "user", content: payload });
          }
          if (call.name === "write_report" && out.ok !== false) refreshFiles();
        }
      }

      if (!finalText) {
        finalText = "I reached the tool-step limit. Ask me to continue from the last result.";
      }
      bubble.innerHTML = md(finalText);
      thread.querySelectorAll(".traces.live").forEach((n) => n.remove());
      c.messages.push({ role: "assistant", content: finalText, traces });
      saveChats();
      renderThread();
    } catch (err) {
      bubble.textContent = String(err.message || err);
      c.messages.push({ role: "assistant", content: String(err.message || err), traces });
      saveChats();
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

  async function refreshFiles() {
    const el = $("fileList");
    try {
      const data = await callTool("list_files", { folder: "all" });
      const files = T.asList(data.files);
      if (!files.length) {
        el.innerHTML = '<div class="empty">No files in data/ or reports/</div>';
        return;
      }
      el.innerHTML = "";
      files.forEach((f) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = f.path || f.name;
        b.title = f.path;
        b.onclick = () => {
          const p = f.path || f.name;
          if (/\.(csv|tsv|json)$/i.test(p)) send("Profile " + p + " with tools and explain the key numbers.");
          else send("Read " + p + " with tools and summarize it.");
        };
        el.appendChild(b);
      });
    } catch {
      el.innerHTML = '<div class="empty">Files unavailable until the dashboard API is up.</div>';
    }
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
  document.querySelectorAll(".suggestions [data-q]").forEach((btn) => {
    btn.addEventListener("click", () => send(btn.getAttribute("data-q")));
  });

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
    if (busy) return;
    try {
      const res = await fetch(API + "/health", { cache: "no-store" });
      if (!res.ok) throw new Error("down");
      engine = true;
      engineStatus.className = "pill ok";
      engineStatus.textContent = "Online · agent";
      sendBtn.disabled = busy;
    } catch {
      engine = false;
      engineStatus.className = "pill wait";
      engineStatus.textContent = "Starting model…";
      sendBtn.disabled = true;
    }
  }

  async function loadStatus() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const s = await r.json();
      if (s.model) modelNameEl.textContent = s.model.replace(/\.gguf$/i, "") + " · USB";
    } catch {}
  }

  loadChatsFromUsb().then(() => {
    renderNav();
    renderThread();
    input.focus();
  });
  refreshFiles();
  loadStatus();
  ping();
  setInterval(ping, 4000);
})();
