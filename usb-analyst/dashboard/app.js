(() => {
  const API = location.protocol === "file:" ? "http://127.0.0.1:8091" : "";
  const state = { files: [], active: 0, engine: false };

  const $ = (id) => document.getElementById(id);
  const engineStatus = $("engineStatus");
  const fileList = $("fileList");
  const emptyFiles = $("emptyFiles");
  const colList = $("colList");
  const kpis = $("kpis");
  const charts = $("charts");
  const tableHost = $("tableHost");
  const transcript = $("transcript");
  const suggestions = $("suggestions");
  const dropZone = $("dropZone");
  const briefBtn = $("briefBtn");

  function fmt(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function parseCSV(text, sep) {
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    const src = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }

  function rowsToObjects(grid) {
    if (!grid.length) return { columns: [], records: [] };
    const columns = grid[0].map((h, i) => (String(h).trim() || "col_" + (i + 1)));
    const records = grid.slice(1).map((r) => {
      const o = {};
      columns.forEach((c, i) => { o[c] = r[i] == null ? "" : String(r[i]).trim(); });
      return o;
    });
    return { columns, records };
  }

  function looksNumber(v) {
    if (v === "" || v == null) return false;
    const t = String(v).replace(/[,₹$%\s]/g, "");
    return t !== "" && !Number.isNaN(Number(t));
  }
  function toNumber(v) {
    const t = String(v).replace(/[,₹$%\s]/g, "");
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  function looksDate(v) {
    if (!v) return false;
    return /^\d{4}-\d{1,2}-\d{1,2}/.test(v) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v);
  }

  function profile(columns, records) {
    const types = {};
    const stats = {};
    for (const c of columns) {
      const vals = records.map((r) => r[c]).filter((v) => v !== "");
      const numN = vals.filter(looksNumber).length;
      const dateN = vals.filter(looksDate).length;
      let type = "text";
      if (vals.length && dateN / vals.length > 0.6) type = "date";
      else if (vals.length && numN / vals.length > 0.7) type = "number";
      else if (new Set(vals).size <= Math.max(12, vals.length * 0.4)) type = "category";
      types[c] = type;
      if (type === "number") {
        const nums = vals.map(toNumber).filter((n) => n != null);
        const sum = nums.reduce((a, b) => a + b, 0);
        stats[c] = {
          count: nums.length,
          missing: records.length - nums.length,
          sum,
          mean: nums.length ? sum / nums.length : 0,
          min: nums.length ? Math.min(...nums) : 0,
          max: nums.length ? Math.max(...nums) : 0,
        };
      } else {
        const counts = {};
        vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
        stats[c] = {
          missing: records.length - vals.length,
          unique: Object.keys(counts).length,
          top: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8),
        };
      }
    }
    return { types, stats };
  }

  function parseFile(file, text) {
    const name = file.name.toLowerCase();
    let columns = [];
    let records = [];
    if (name.endsWith(".json")) {
      let data = JSON.parse(text);
      if (data && Array.isArray(data.data)) data = data.data;
      if (!Array.isArray(data) || !data.length || typeof data[0] !== "object") {
        throw new Error("JSON must be an array of objects.");
      }
      columns = Object.keys(data[0]);
      records = data.map((row) => {
        const o = {};
        columns.forEach((c) => { o[c] = row[c] == null ? "" : String(row[c]); });
        return o;
      });
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      throw new Error("Excel is not parsed on-device. In Excel use File → Save As → CSV, then drop that file.");
    } else {
      const sep = name.endsWith(".tsv") || (text.split("\t").length > text.split(",").length * 2) ? "\t" : ",";
      const parsed = rowsToObjects(parseCSV(text, sep));
      columns = parsed.columns;
      records = parsed.records;
    }
    const { types, stats } = profile(columns, records);
    return { name: file.name, columns, records, types, stats };
  }

  function contextBlock(ds) {
    if (!ds) return "No dataset is loaded.";
    const lines = [
      "File: " + ds.name,
      "Rows: " + ds.records.length,
      "Columns: " + ds.columns.join(", "),
      "Column types: " + ds.columns.map((c) => c + "=" + ds.types[c]).join("; "),
      "Authoritative metrics (computed by the dashboard — do not recalculate):",
    ];
    for (const c of ds.columns) {
      const s = ds.stats[c];
      if (ds.types[c] === "number") {
        lines.push(`  ${c}: sum=${s.sum}, mean=${s.mean}, min=${s.min}, max=${s.max}, n=${s.count}, missing=${s.missing}`);
      } else if (s.top) {
        lines.push(`  ${c}: missing=${s.missing}, unique=${s.unique}, top=${s.top.map((x) => x[0] + "(" + x[1] + ")").join(", ")}`);
      }
    }
    const sample = ds.records.slice(0, 40);
    lines.push("Sample rows (CSV):");
    lines.push(ds.columns.join(","));
    sample.forEach((r) => lines.push(ds.columns.map((c) => r[c]).join(",")));
    return lines.join("\n");
  }

  function systemPrompt() {
    return [
      "You are a business analyst for an offline USB briefing tool.",
      "Use ONLY the dataset facts provided. Numbers in 'Authoritative metrics' are correct.",
      "Do not invent rows, files, or totals. Do not write Python or tool_code.",
      "Write concise business English: what happened, what stands out, what to check next.",
      "If the table has no data rows, say EMPTY.",
    ].join(" ");
  }

  function renderFiles() {
    fileList.innerHTML = "";
    emptyFiles.style.display = state.files.length ? "none" : "block";
    state.files.forEach((f, i) => {
      const li = document.createElement("li");
      li.textContent = f.name + " · " + f.records.length + " rows";
      if (i === state.active) li.className = "active";
      li.onclick = () => { state.active = i; renderAll(); };
      fileList.appendChild(li);
    });
    briefBtn.disabled = !state.files.length || !state.engine;
  }

  function renderCols(ds) {
    colList.innerHTML = "";
    if (!ds) return;
    ds.columns.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = c + " · " + ds.types[c];
      colList.appendChild(li);
    });
  }

  function renderKpis(ds) {
    kpis.innerHTML = "";
    if (!ds) return;
    const cards = [
      { label: "Rows", value: ds.records.length },
      { label: "Columns", value: ds.columns.length },
    ];
    const nums = ds.columns.filter((c) => ds.types[c] === "number").slice(0, 3);
    nums.forEach((c) => {
      cards.push({ label: "Sum · " + c, value: fmt(ds.stats[c].sum) });
    });
    if (!nums.length) {
      cards.push({ label: "Empty cells", value: ds.columns.reduce((a, c) => a + (ds.stats[c].missing || 0), 0) });
    }
    cards.forEach((k) => {
      const el = document.createElement("div");
      el.className = "kpi";
      el.innerHTML = "<span>" + k.label + "</span><b>" + k.value + "</b>";
      kpis.appendChild(el);
    });
  }

  function drawBar(canvas, labels, values, title) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = 360;
    ctx.scale(2, 2);
    const W = w / 2, H = h / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#1c1915";
    ctx.font = "12px Segoe UI";
    ctx.fillText(title, 8, 16);
    const max = Math.max(...values, 1);
    const gap = 8;
    const barW = (W - 24) / values.length - gap;
    values.forEach((v, i) => {
      const bh = (H - 48) * (v / max);
      const x = 12 + i * (barW + gap);
      const y = H - 22 - bh;
      ctx.fillStyle = "#b5471b";
      ctx.fillRect(x, y, Math.max(barW, 2), bh);
      ctx.fillStyle = "#6b6258";
      ctx.save();
      ctx.translate(x + barW / 2, H - 8);
      ctx.rotate(-0.4);
      ctx.fillText(String(labels[i]).slice(0, 10), 0, 0);
      ctx.restore();
    });
  }

  function drawLine(canvas, labels, values, title) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = 360;
    ctx.scale(2, 2);
    const W = w / 2, H = h / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#1c1915";
    ctx.font = "12px Segoe UI";
    ctx.fillText(title, 8, 16);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    ctx.beginPath();
    ctx.strokeStyle = "#2f6f4e";
    ctx.lineWidth = 2;
    values.forEach((v, i) => {
      const x = 16 + (i * (W - 32)) / Math.max(values.length - 1, 1);
      const y = 28 + (H - 50) * (1 - (v - min) / span);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderCharts(ds) {
    charts.innerHTML = "";
    if (!ds || !ds.records.length) return;
    const cats = ds.columns.filter((c) => ds.types[c] === "category" || ds.types[c] === "text");
    const nums = ds.columns.filter((c) => ds.types[c] === "number");
    const dates = ds.columns.filter((c) => ds.types[c] === "date");

    function card() {
      const wrap = document.createElement("div");
      wrap.className = "chart-card";
      const h = document.createElement("h3");
      const cv = document.createElement("canvas");
      wrap.appendChild(h);
      wrap.appendChild(cv);
      charts.appendChild(wrap);
      return { wrap, h, cv };
    }

    if (cats.length && nums.length) {
      const cat = cats[0], num = nums[0];
      const acc = {};
      ds.records.forEach((r) => {
        const k = r[cat] || "(blank)";
        const v = toNumber(r[num]) || 0;
        acc[k] = (acc[k] || 0) + v;
      });
      const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const c = card();
      c.h.textContent = num + " by " + cat;
      requestAnimationFrame(() => drawBar(c.cv, top.map((x) => x[0]), top.map((x) => x[1]), ""));
    }

    if (dates.length && nums.length) {
      const d = dates[0], num = nums[0];
      const acc = {};
      ds.records.forEach((r) => {
        const k = r[d] || "";
        acc[k] = (acc[k] || 0) + (toNumber(r[num]) || 0);
      });
      const series = Object.entries(acc).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const c = card();
      c.h.textContent = num + " over " + d;
      requestAnimationFrame(() => drawLine(c.cv, series.map((x) => x[0]), series.map((x) => x[1]), ""));
    } else if (nums.length) {
      const num = nums[0];
      const vals = ds.records.map((r) => toNumber(r[num])).filter((n) => n != null).sort((a, b) => a - b);
      const c = card();
      c.h.textContent = "Distribution · " + num;
      const bins = 8;
      if (vals.length) {
        const min = vals[0], max = vals[vals.length - 1];
        const step = (max - min) / bins || 1;
        const counts = Array(bins).fill(0);
        const labels = [];
        for (let i = 0; i < bins; i++) {
          labels.push(fmt(min + i * step));
        }
        vals.forEach((v) => {
          let i = Math.floor((v - min) / step);
          if (i >= bins) i = bins - 1;
          if (i < 0) i = 0;
          counts[i]++;
        });
        requestAnimationFrame(() => drawBar(c.cv, labels, counts, ""));
      }
    }

    if (!charts.children.length && cats.length) {
      const cat = cats[0];
      const top = (ds.stats[cat].top || []).slice(0, 8);
      const c = card();
      c.h.textContent = "Counts · " + cat;
      requestAnimationFrame(() => drawBar(c.cv, top.map((x) => x[0]), top.map((x) => x[1]), ""));
    }
  }

  function renderTable(ds) {
    if (!ds) {
      tableHost.innerHTML = '<p class="hint">Drop a spreadsheet to see rows.</p>';
      return;
    }
    const show = ds.records.slice(0, 80);
    let html = "<table><thead><tr>" + ds.columns.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>";
    show.forEach((r) => {
      html += "<tr>" + ds.columns.map((c) => "<td>" + String(r[c]).replace(/</g, "&lt;") + "</td>").join("") + "</tr>";
    });
    html += "</tbody></table>";
    if (ds.records.length > 80) html += '<p class="hint">Showing 80 of ' + ds.records.length + " rows.</p>";
    tableHost.innerHTML = html;
  }

  function suggest(ds) {
    suggestions.innerHTML = "";
    const qs = [];
    if (!ds) {
      qs.push("What files should a weekly business review include?");
    } else {
      qs.push("Summarise this table for a management meeting.");
      qs.push("What stands out, and what should we verify in Excel?");
      const nums = ds.columns.filter((c) => ds.types[c] === "number");
      const cats = ds.columns.filter((c) => ds.types[c] === "category" || ds.types[c] === "text");
      if (cats.length && nums.length) qs.push("Which " + cats[0] + " dominates " + nums[0] + "?");
      if (ds.records.length === 0) qs.push("This file looks empty. Confirm.");
    }
    qs.slice(0, 4).forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.onclick = () => { $("question").value = q; $("chatForm").requestSubmit(); };
      suggestions.appendChild(b);
    });
  }

  function renderAll() {
    const ds = state.files[state.active];
    $("boardTitle").textContent = ds ? ds.name : "Business dashboard";
    $("boardSub").textContent = ds
      ? ds.records.length + " rows · figures below are calculated in the browser"
      : "Load a table to generate KPIs and charts. Numbers are computed here; the model writes the narrative.";
    renderFiles();
    renderCols(ds);
    renderKpis(ds);
    renderCharts(ds);
    renderTable(ds);
    suggest(ds);
  }

  function addMsg(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.textContent = text;
    transcript.appendChild(el);
    transcript.scrollTop = transcript.scrollHeight;
    return el;
  }

  async function ask(question, extraUser) {
    if (!state.engine) throw new Error("Model is not ready yet.");
    const ds = state.files[state.active];
    const messages = [
      { role: "system", content: systemPrompt() },
      { role: "user", content: (extraUser || contextBlock(ds)) + "\n\nQuestion: " + question },
    ];
    const res = await fetch(API + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0.2, max_tokens: 700 }),
    });
    if (!res.ok) throw new Error("Model HTTP " + res.status);
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  }

  async function loadFiles(fileListLike) {
    for (const file of fileListLike) {
      const text = await file.text();
      try {
        const ds = parseFile(file, text);
        state.files.push(ds);
        state.active = state.files.length - 1;
      } catch (err) {
        addMsg("assistant", file.name + ": " + err.message);
      }
    }
    renderAll();
  }

  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("over"); });
  });
  dropZone.addEventListener("drop", (e) => loadFiles(e.dataTransfer.files));
  $("fileInput").addEventListener("change", (e) => loadFiles(e.target.files));

  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("question").value.trim();
    if (!q) return;
    $("question").value = "";
    addMsg("user", q);
    const box = addMsg("assistant", "Working…");
    $("askBtn").disabled = true;
    try {
      box.textContent = await ask(q);
    } catch (err) {
      box.textContent = String(err.message || err);
    }
    $("askBtn").disabled = false;
  });

  briefBtn.addEventListener("click", async () => {
    const box = addMsg("user", "Write an executive brief.");
    const out = addMsg("assistant", "Working…");
    try {
      out.textContent = await ask(
        "Write a one-page executive brief: situation, 3 findings, 3 risks, 3 recommended actions. Use only the authoritative metrics. No code."
      );
    } catch (err) {
      out.textContent = String(err.message || err);
    }
  });

  async function ping() {
    try {
      const res = await fetch(API + "/health", { cache: "no-store" });
      if (!res.ok) throw new Error("down");
      state.engine = true;
      engineStatus.className = "status ok";
      engineStatus.textContent = "Model ready · llama.cpp";
      briefBtn.disabled = !state.files.length;
    } catch {
      state.engine = false;
      engineStatus.className = "status wait";
      engineStatus.textContent = "Waiting for llama.cpp… keep this tab open";
      briefBtn.disabled = true;
    }
  }

  renderAll();
  ping();
  setInterval(ping, 4000);
})();
