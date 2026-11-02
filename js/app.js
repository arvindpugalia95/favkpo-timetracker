const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = s => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "";
const hrs = v => v === "" || v == null ? "" : Number(v).toFixed(2);

let ME = null, META = null, editing = null, entriesScope = "mine", lastEntries = [];

function toast(msg, ok = true) {
  const t = $("#toast"); t.textContent = msg; t.className = ok ? "ok" : "err";
  clearTimeout(t._h); t._h = setTimeout(() => t.className = "", ok ? 2500 : 5000);
}
function show(id) { ["#v-login", "#v-pass", "#v-app"].forEach(v => $(v).classList.toggle("hidden", v !== id)); }
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, false); } finally { btn.disabled = false; }
}
function options(sel, items, { blank } = {}) {
  sel.innerHTML = (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") +
    items.map(i => typeof i === "object" ? `<option value="${esc(i.value)}">${esc(i.label)}</option>` : `<option>${esc(i)}</option>`).join("");
}

/* ---------- Auth ---------- */
$("#f-login").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  busy($("button", f), async () => {
    const r = await api("login", { userId: f.userId.value.trim(), password: f.password.value });
    sessionStorage.setItem("tt_token", r.token);
    f.reset();
    ME = r.user;
    if (ME.mustChange) { $("#pass-cancel").hidden = true; $("#pass-note").textContent = "This is your first login. Set a new password to continue."; show("#v-pass"); }
    else start();
  });
});

$("#f-pass").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  if (f.newPassword.value !== f.repeat.value) return toast("New passwords don't match", false);
  busy($("button", f), async () => {
    await api("changePassword", { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value });
    f.reset(); toast("Password saved");
    ME.mustChange = false; start();
  });
});
$("#pass-cancel").onclick = () => show("#v-app");
$("#btn-pass").onclick = () => { $("#pass-cancel").hidden = false; $("#pass-note").textContent = "At least 6 characters."; show("#v-pass"); };
$("#btn-logout").onclick = async () => { try { await api("logout"); } catch (e) {} sessionStorage.clear(); location.reload(); };

/* ---------- Start ---------- */
async function start() {
  try { META = await api("getMeta"); } catch (e) { toast(e.message, false); show("#v-login"); return; }
  ME = META.user;
  sessionStorage.setItem("tt_user", JSON.stringify(ME));
  const mgr = ME.type === "Admin" || ME.type === "Lead";
  $$(".mgr").forEach(el => el.classList.toggle("hidden", !mgr));
  $$(".adm").forEach(el => el.classList.toggle("hidden", ME.type !== "Admin"));
  $("#who").textContent = `${ME.name} (${ME.type})`;
  fillFilters();
  show("#v-app");
  go("log");
}

function go(view, keepDay) {
  $$("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $("#p-log").classList.toggle("hidden", view !== "log");
  $("#p-entries").classList.toggle("hidden", view !== "mine" && view !== "team");
  $("#p-admin").classList.toggle("hidden", view !== "admin");
  if (view === "mine" || view === "team") { entriesScope = view; $("#entries-title").textContent = view === "mine" ? "My entries" : "Team entries"; loadEntries(); }
  if (view === "admin") adminTab("users");
  if (view === "log" && !keepDay) { dayCtx = null; dayRows = []; loadDay($("#day-date").value || todayStr()); }
}
$$("#nav button").forEach(b => b.onclick = () => {
  if (typeof dirtyCount === "function" && dirtyCount() && !confirm("You have unsaved rows. Discard them?")) return;
  dayRows = []; go(b.dataset.view);
});

/* ---------- Log time: one day as a table ---------- */
let dayRows = [], dayCtx = null;
const isMgr = () => ME && (ME.type === "Admin" || ME.type === "Lead");
const FIELDS = ["clientId", "projectId", "recurring", "activity", "subActivity", "description", "estHrs", "actualHrs", "effectiveHrs", "billedHrs", "status"];
const defStatus = () => { const s = META.lists["Status"] || []; return s.includes("Done") ? "Done" : (s[0] || ""); };
const blankRow = () => ({ _new: true, clientId: META.clients.length === 1 ? META.clients[0].id : "", projectId: "",
  recurring: (META.lists["Recurring/Adhoc"] || [""])[0], activity: "", subActivity: "", description: "",
  estHrs: "", actualHrs: "", effectiveHrs: "", billedHrs: "", status: defStatus() });
const isBlank = r => !r.description && !r.actualHrs && !r.activity;
function fromEntry(x) {
  const p = META.projects.find(p => p.clientId === x.clientId && p.name === x.project);
  return { ...x, projectId: p ? p.id : "", _new: false, _dirty: false };
}
const dirtyCount = () => dayRows.filter(r => r._new ? !isBlank(r) : r._dirty).length;

function fillFilters() {
  options($("#fl-client"), META.clients.map(c => ({ value: c.id, label: c.name })), { blank: "All clients" });
}

async function loadDay(date, preset) {
  if (!preset && dirtyCount() && !confirm("You have unsaved rows. Discard them?")) { $("#day-date").value = dayRows._date || date; return; }
  $("#day-date").value = date;
  dayCtx = preset ? preset.ctx : null;
  const other = dayCtx && dayCtx.user !== ME.name;
  $("#log-title").textContent = other ? `Entries of ${dayCtx.user}` : "Log time";
  $("#row-add").hidden = !!other;
  $("#day-back").hidden = !dayCtx;
  ["#day-prev", "#day-next", "#day-today", "#day-date"].forEach(s => $(s).disabled = !!dayCtx);
  if (preset) { dayRows = preset.rows.map(fromEntry); }
  else {
    $("#t-day").innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
    try { dayRows = (await api("listEntries", { scope: "mine", from: date, to: date })).map(fromEntry); }
    catch (e) { toast(e.message, false); dayRows = []; }
    const blanks = dayRows.length ? 2 : 4;
    for (let i = 0; i < blanks; i++) dayRows.push(blankRow());
  }
  dayRows._date = date;
  renderDay();
}

function cellSelect(i, k, items, val, blank, disabled) {
  const opts = (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") +
    items.map(o => { const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
      return `<option value="${esc(v)}"${String(v) === String(val ?? "") ? " selected" : ""}>${esc(l)}</option>`; }).join("");
  return `<select data-i="${i}" data-k="${k}"${disabled ? " disabled" : ""}>${opts}</select>`;
}
const cellNum = (i, k, v, ph = "") => `<td class="c-num"><input type="number" step="0.01" min="0" data-i="${i}" data-k="${k}" value="${esc(v)}" placeholder="${ph}"></td>`;

function renderDay() {
  const L = META.lists, mgr = isMgr();
  const clients = META.clients.map(c => ({ value: c.id, label: c.name }));
  let html = `<tr><th>#</th><th>Client</th><th>Project</th><th>Rec / Adhoc</th><th>Activity</th><th>Sub activity</th><th>Description</th>
    <th>Est hrs</th><th>Actual hrs</th>${mgr ? "<th>Effective</th><th>Billed</th>" : ""}<th>Status</th><th></th></tr>`;
  dayRows.forEach((r, i) => {
    const ps = META.projects.filter(p => p.clientId === r.clientId).map(p => ({ value: p.id, label: p.name }));
    const cls = r._dirty || (r._new && !isBlank(r)) ? "dirty" : (!r._new ? "saved" : "");
    html += `<tr class="${cls}"><td class="rownum">${i + 1}</td>
      <td>${cellSelect(i, "clientId", clients, r.clientId, "Client…", !r._new)}</td>
      <td>${cellSelect(i, "projectId", ps, r.projectId, ps.length ? "Project…" : "—")}</td>
      <td>${cellSelect(i, "recurring", L["Recurring/Adhoc"] || [], r.recurring)}</td>
      <td>${cellSelect(i, "activity", L["Activity"] || [], r.activity, "Activity…")}</td>
      <td>${cellSelect(i, "subActivity", L["Sub Activity"] || [], r.subActivity, "")}</td>
      <td class="c-desc"><textarea rows="1" data-i="${i}" data-k="description" placeholder="What did you do?">${esc(r.description)}</textarea></td>
      ${cellNum(i, "estHrs", r.estHrs)}${cellNum(i, "actualHrs", r.actualHrs)}
      ${mgr ? cellNum(i, "effectiveHrs", r.effectiveHrs, "= actual") + cellNum(i, "billedHrs", r.billedHrs) : ""}
      <td>${cellSelect(i, "status", L["Status"] || [], r.status)}</td>
      <td><button class="x" data-del="${i}" title="Delete row">&times;</button></td></tr>`;
  });
  $("#t-day").innerHTML = html;
  updateDayTotal();
}

function updateDayTotal() {
  const total = dayRows.reduce((s, r) => s + (Number(r.actualHrs) || 0), 0);
  $("#day-total").textContent = `${total.toFixed(2)} hrs`;
  const n = dirtyCount();
  $("#day-note").textContent = n ? `${n} unsaved row${n > 1 ? "s" : ""}` : "";
}

function onCell(e) {
  const el = e.target; if (el.dataset.i === undefined) return;
  const r = dayRows[el.dataset.i], k = el.dataset.k;
  r[k] = el.value; r._dirty = true;
  if (k === "clientId") { r.projectId = ""; renderDay(); return; }
  if (k === "projectId") { const p = META.projects.find(p => p.id === el.value); if (p && p.type) { r.recurring = p.type; renderDay(); return; } }
  const tr = el.closest("tr"); if (!tr.classList.contains("dirty")) { tr.classList.remove("saved"); tr.classList.add("dirty"); }
  updateDayTotal();
}
$("#t-day").addEventListener("input", onCell);
$("#t-day").addEventListener("change", e => { if (e.target.tagName === "SELECT") onCell(e); });
$("#t-day").addEventListener("keydown", e => {
  // Enter in the last row's description adds a new row
  if (e.key === "Enter" && !e.shiftKey && e.target.dataset.k === "description" && Number(e.target.dataset.i) === dayRows.length - 1 && !$("#row-add").hidden) {
    e.preventDefault(); addRow();
  }
});
$("#t-day").addEventListener("click", e => {
  const b = e.target.closest("button[data-del]"); if (!b) return;
  const i = Number(b.dataset.del), r = dayRows[i];
  if (r._new) { dayRows.splice(i, 1); if (!dayRows.length) dayRows.push(blankRow()); renderDay(); return; }
  if (!confirm(`Delete this saved entry?\n${r.clientName || ""} · ${r.description}`)) return;
  busy(b, async () => { await api("deleteEntry", { entryId: r.entryId, clientId: r.clientId }); dayRows.splice(i, 1); renderDay(); toast("Entry deleted"); });
});

function addRow() {
  const last = dayRows[dayRows.length - 1], n = blankRow();
  if (last && last.clientId) { n.clientId = last.clientId; n.projectId = last.projectId; n.recurring = last.recurring; }
  dayRows.push(n); renderDay();
  const ta = $$(`#t-day textarea`).pop(); if (ta) ta.focus();
}
$("#row-add").onclick = addRow;

$("#day-save").onclick = () => busy($("#day-save"), async () => {
  const date = $("#day-date").value;
  const todo = dayRows.map((r, i) => ({ r, i })).filter(({ r }) => r._new ? !isBlank(r) : r._dirty);
  if (!todo.length) return toast("Nothing to save");
  for (const { r, i } of todo) {
    const miss = [!r.clientId && "client", !r.activity && "activity", !r.description && "description", !(Number(r.actualHrs) > 0) && "actual hrs"].filter(Boolean);
    if (miss.length) throw new Error(`Row ${i + 1}: add ${miss.join(", ")}`);
  }
  const pick = r => Object.fromEntries(FIELDS.map(k => [k, r[k] ?? ""]));
  const res = await Promise.allSettled(todo.map(({ r }) => r._new
    ? api("addEntry", { ...pick(r), date })
    : api("updateEntry", { ...pick(r), date: r.date || date, entryId: r.entryId })));
  const failed = res.map((x, j) => x.status === "rejected" ? `Row ${todo[j].i + 1}: ${x.reason.message}` : null).filter(Boolean);
  res.forEach((x, j) => { if (x.status === "fulfilled") { const r = todo[j].r; r._dirty = false; if (r._new) { r._new = false; r.entryId = x.value.entryId; } } });
  if (failed.length) { renderDay(); throw new Error(failed.join(" | ")); }
  toast(`${todo.length} row${todo.length > 1 ? "s" : ""} saved`);
  if (dayCtx) { dayCtx = null; go(entriesScope); } else { dayRows = []; loadDay(date); }
});

$("#day-date").addEventListener("change", e => loadDay(e.target.value));
$("#day-prev").onclick = () => loadDay(addDays($("#day-date").value, -1));
$("#day-next").onclick = () => loadDay(addDays($("#day-date").value, 1));
$("#day-today").onclick = () => loadDay(todayStr());
$("#day-back").onclick = () => { if (dirtyCount() && !confirm("Discard unsaved changes?")) return; dayRows = []; dayCtx = null; go(entriesScope); };
window.addEventListener("beforeunload", e => { if (dirtyCount()) { e.preventDefault(); e.returnValue = ""; } });

function startEdit(x) {
  const rows = lastEntries.filter(e => e.date === x.date && e.user === x.user);
  go("log", true);
  loadDay(x.date, { rows, ctx: { user: x.user } });
}

/* ---------- Entries ---------- */
$("#fl-to").value = todayStr(); $("#fl-from").value = addDays(todayStr(), -30);
$("#fl-go").onclick = () => loadEntries();

async function loadEntries() {
  const t = $("#t-entries");
  t.innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
  try {
    lastEntries = await api("listEntries", { scope: entriesScope, from: $("#fl-from").value, to: $("#fl-to").value, clientId: $("#fl-client").value });
  } catch (e) { t.innerHTML = `<tr><td class="empty">${esc(e.message)}</td></tr>`; return; }
  const total = lastEntries.reduce((s, x) => s + (Number(x.effectiveHrs) || 0), 0);
  $("#fl-total").textContent = `${lastEntries.length} entries · ${total.toFixed(2)} effective hrs`;
  if (!lastEntries.length) { t.innerHTML = `<tr><td class="empty">No entries in this period. Change the dates or log time first.</td></tr>`; return; }
  const team = entriesScope === "team";
  t.innerHTML = `<tr><th>Date</th><th>Client</th><th>Project</th><th>Activity</th><th>Description</th><th>Actual</th><th>Effective</th><th>Billed</th>${team ? "<th>User</th>" : ""}<th></th></tr>` +
    lastEntries.map((x, i) => `<tr><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(x.clientName)}</td><td>${esc(x.project)}</td>
      <td>${esc(x.activity)}${x.subActivity ? " / " + esc(x.subActivity) : ""}</td><td>${esc(x.description)}</td>
      <td class="num">${hrs(x.actualHrs)}</td><td class="num">${hrs(x.effectiveHrs)}</td><td class="num">${hrs(x.billedHrs)}</td>
      ${team ? `<td>${esc(x.user)}</td>` : ""}
      <td class="nowrap"><button class="btn small" data-edit="${i}">Edit</button> <button class="btn small danger" data-del="${i}">Delete</button></td></tr>`).join("");
}
$("#t-entries").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.edit) startEdit(lastEntries[b.dataset.edit]);
  if (b.dataset.del) {
    const x = lastEntries[b.dataset.del];
    if (!confirm(`Delete this entry?\n${fmtDate(x.date)} · ${x.clientName} · ${x.description}`)) return;
    busy(b, async () => { await api("deleteEntry", { entryId: x.entryId, clientId: x.clientId }); toast("Entry deleted"); loadEntries(); });
  }
});

/* ---------- Admin ---------- */
let admTab = "users", admData = { users: [], clients: [], projects: [] }, admEdit = null;
$$("#adm-nav button").forEach(b => b.onclick = () => adminTab(b.dataset.a));

const YN = [{ value: "Y", label: "Active" }, { value: "N", label: "Inactive" }];
const ADMIN = {
  users: {
    list: "listUsers", save: "saveUser", key: "user",
    fields: () => [["userId", "User ID", "text", null, true], ["name", "Name"], ["email", "Email", "email"],
      ["type", "User type", "select", (META.lists["User Type"] || ["Admin", "Lead", "Staff"])], ["active", "Status", "select", YN],
      ["password", admEdit ? "Reset password (optional)" : "Temporary password", "password"]],
    cols: [["userId", "User ID"], ["name", "Name"], ["email", "Email"], ["type", "Type"], ["active", "Active"]],
    fromRow: u => u, id: u => u.userId
  },
  clients: {
    list: "listClients", save: "saveClient", key: "client",
    fields: () => [["name", "Client name"], ["company", "Company name"], ["contact", "Contact person"], ["lead", "FAVKPO lead"],
      ["team", "FAVKPO team"], ["folderLink", "Folder link", "url"], ["active", "Status", "select", YN]],
    cols: [["Client ID", "ID"], ["Client Name", "Client"], ["Company Name", "Company"], ["FAVKPO Lead", "Lead"], ["Active", "Active"]],
    fromRow: c => ({ id: c["Client ID"], name: c["Client Name"], company: c["Company Name"], contact: c["Contact Person"],
      lead: c["FAVKPO Lead"], team: c["FAVKPO Team"], folderLink: c["Folder Link"], active: c["Active"] }),
    id: c => c["Client ID"]
  },
  projects: {
    list: "listProjects", save: "saveProject", key: "project",
    fields: () => [["clientId", "Client", "select", admData.clients.map(c => ({ value: c["Client ID"], label: c["Client Name"] }))],
      ["name", "Project name"], ["type", "Recurring / Adhoc", "select", META.lists["Recurring/Adhoc"] || []], ["active", "Status", "select", YN]],
    cols: [["Project ID", "ID"], ["_client", "Client"], ["Project Name", "Project"], ["Recurring/Adhoc", "Type"], ["Active", "Active"]],
    fromRow: p => ({ id: p["Project ID"], clientId: p["Client ID"], name: p["Project Name"], type: p["Recurring/Adhoc"], active: p["Active"] }),
    id: p => p["Project ID"]
  },
  assign: {
    list: "listAssignments", save: "saveAssignment", key: "assignment", noEdit: true,
    fields: () => [["userId", "User", "select", admData.users.filter(u => u.type !== "Admin").map(u => ({ value: u.userId, label: `${u.name} (${u.type})` }))],
      ["clientId", "Client", "select", admData.clients.map(c => ({ value: c["Client ID"], label: c["Client Name"] }))],
      ["projectId", "Project (optional)", "select", [{ value: "", label: "All projects" }]]],
    cols: [["_user", "User"], ["_client", "Client"], ["_project", "Project"], ["Assigned Date", "Assigned"]],
    id: a => a["Assignment ID"]
  }
};

async function adminTab(tab) {
  admTab = tab; admEdit = null;
  $$("#adm-nav button").forEach(b => b.classList.toggle("active", b.dataset.a === tab));
  $("#t-admin").innerHTML = `<tr><td class="empty">Loading…</td></tr>`;
  try {
    const need = { users: ["users"], clients: ["clients"], projects: ["clients", "projects"], assign: ["users", "clients", "projects", "assign"] }[tab];
    const calls = { users: "listUsers", clients: "listClients", projects: "listProjects", assign: "listAssignments" };
    const res = await Promise.all(need.map(k => api(calls[k])));
    need.forEach((k, i) => admData[k] = res[i]);
  } catch (e) { $("#t-admin").innerHTML = `<tr><td class="empty">${esc(e.message)}</td></tr>`; return; }
  renderAdminForm(); renderAdminTable();
}

function renderAdminForm(values = {}) {
  const cfg = ADMIN[admTab], f = $("#f-admin");
  f.innerHTML = cfg.fields().map(([n, label, type = "text", opts, lockOnEdit]) => type === "select"
    ? `<label>${label}<select name="${n}"></select></label>`
    : `<label>${label}<input name="${n}" type="${type}" ${lockOnEdit && admEdit ? "readonly" : ""}></label>`).join("") +
    `<div class="actions wide"><button class="btn primary" type="submit">${admEdit ? "Save changes" : "Add " + { users: "user", clients: "client", projects: "project", assign: "assignment" }[admTab]}</button>
     ${admEdit ? `<button class="btn" type="button" id="adm-cancel">Cancel</button>` : ""}</div>`;
  cfg.fields().forEach(([n, , type, opts]) => { if (type === "select") options(f[n], opts); });
  if (admTab === "assign") {
    const upd = () => { const ps = admData.projects.filter(p => p["Client ID"] === f.clientId.value && p["Active"] === "Y");
      options(f.projectId, [{ value: "", label: "All projects" }, ...ps.map(p => ({ value: p["Project ID"], label: p["Project Name"] }))]); };
    f.clientId.onchange = upd; upd();
  }
  Object.entries(values).forEach(([k, v]) => { if (f[k] && k !== "password") f[k].value = v ?? ""; });
  if ($("#adm-cancel")) $("#adm-cancel").onclick = () => { admEdit = null; renderAdminForm(); };
}

$("#f-admin").addEventListener("submit", e => {
  e.preventDefault();
  const cfg = ADMIN[admTab], d = Object.fromEntries(new FormData(e.target));
  if (admEdit && admTab !== "users") d.id = admEdit;
  busy($("button[type=submit]", e.target), async () => {
    await api(cfg.save, { [cfg.key]: d, isNew: !admEdit });
    toast(admEdit ? "Saved" : "Added");
    if (admTab === "clients" || admTab === "projects" || admTab === "assign") META = await api("getMeta").catch(() => META), fillFilters();
    adminTab(admTab);
  });
});

function renderAdminTable() {
  const cfg = ADMIN[admTab], t = $("#t-admin");
  const rows = admTab === "users" ? admData.users : admTab === "clients" ? admData.clients : admTab === "projects" ? admData.projects : admData.assign;
  const cName = id => (admData.clients.find(c => c["Client ID"] === id) || {})["Client Name"] || id;
  const look = r => ({ ...r, _client: cName(r["Client ID"]),
    _user: (admData.users.find(u => u.userId === r["User ID"]) || {}).name || r["User ID"],
    _project: r["Project ID"] ? ((admData.projects.find(p => p["Project ID"] === r["Project ID"]) || {})["Project Name"] || r["Project ID"]) : "All projects" });
  if (!rows.length) { t.innerHTML = `<tr><td class="empty">Nothing here yet. Use the form above to add the first one.</td></tr>`; return; }
  t.innerHTML = `<tr>${cfg.cols.map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr>` +
    rows.map((r, i) => { const x = look(r); return `<tr>${cfg.cols.map(([k]) => `<td>${esc(x[k])}</td>`).join("")}
      <td class="nowrap">${cfg.noEdit ? `<button class="btn small danger" data-rm="${i}">Remove</button>` : `<button class="btn small" data-ed="${i}">Edit</button>`}</td></tr>`; }).join("");
  t.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const r = rows[b.dataset.ed ?? b.dataset.rm];
    if (b.dataset.ed !== undefined) { admEdit = cfg.id(r); renderAdminForm(cfg.fromRow(r)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (b.dataset.rm !== undefined && confirm("Remove this assignment?"))
      busy(b, async () => { await api("deleteAssignment", { assignmentId: r["Assignment ID"] }); toast("Removed"); META = await api("getMeta"); fillFilters(); adminTab("assign"); });
  };
}

/* ---------- Boot ---------- */
if (sessionStorage.getItem("tt_token")) start(); else show("#v-login");
