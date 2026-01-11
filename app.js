const LEGACY_STORAGE_KEY = "linkCalendar.v1";
const CALENDAR_ID_KEY = "linkCalendar.calendarId.v1";
const CACHE_PREFIX = "linkCalendar.cache.v2.";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return date;
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function normalizeUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return "";
    }
  }
}

function formatMonthHeading(date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function formatSideDate(iso) {
  const date = parseISODate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function mondayFirstIndex(jsDay) {
  // JS: 0=Sun..6=Sat -> Monday-first: 0=Mon..6=Sun
  return (jsDay + 6) % 7;
}

function getMonthGridAnchor(viewDate) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = mondayFirstIndex(firstOfMonth.getDay());
  return new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - offset);
}

function getTodayISO() {
  return toISODate(new Date());
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getOrCreateCalendarId() {
  const existing = String(localStorage.getItem(CALENDAR_ID_KEY) ?? "").trim();
  if (existing) return existing;
  const generated = (crypto?.randomUUID ? crypto.randomUUID() : `cal_${Date.now()}_${Math.random()}`)
    .toString()
    .trim();
  localStorage.setItem(CALENDAR_ID_KEY, generated);
  return generated;
}

function cacheKey(calendarId) {
  return `${CACHE_PREFIX}${calendarId}`;
}

function loadCache(calendarId) {
  const raw = localStorage.getItem(cacheKey(calendarId));
  if (!raw) return { entries: {}, pending: {} };
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return { entries: {}, pending: {} };
  const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
  const pending = parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {};
  return { entries, pending };
}

function saveCache(calendarId, cache) {
  localStorage.setItem(cacheKey(calendarId), JSON.stringify(cache));
}

function toast(title, message) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = "toast";
  const t = document.createElement("div");
  t.className = "title";
  t.textContent = title;
  const m = document.createElement("div");
  m.className = "msg";
  m.textContent = message;
  el.append(t, m);
  host.appendChild(el);

  setTimeout(() => el.remove(), 4500);
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const text = await response.text();
  const body = text ? safeJsonParse(text) : null;
  if (!response.ok) {
    const msg = body?.error || `${response.status} ${response.statusText}`.trim();
    throw new Error(msg);
  }
  return body;
}

const elements = {
  monthHeading: document.getElementById("monthHeading"),
  monthStats: document.getElementById("monthStats"),
  grid: document.getElementById("grid"),
  prevMonth: document.getElementById("prevMonth"),
  nextMonth: document.getElementById("nextMonth"),
  today: document.getElementById("today"),
  exportData: document.getElementById("exportData"),
  importFile: document.getElementById("importFile"),
  cloudStatus: document.getElementById("cloudStatus"),
  manageCalendar: document.getElementById("manageCalendar"),

  sideDate: document.getElementById("sideDate"),
  sideEmpty: document.getElementById("sideEmpty"),
  sideDetails: document.getElementById("sideDetails"),
  sideTitle: document.getElementById("sideTitle"),
  sideUrl: document.getElementById("sideUrl"),
  editSelected: document.getElementById("editSelected"),
  clearSelected: document.getElementById("clearSelected"),

  editDialog: document.getElementById("editDialog"),
  editForm: document.getElementById("editForm"),
  dialogHeading: document.getElementById("dialogHeading"),
  fieldTitle: document.getElementById("fieldTitle"),
  fieldUrl: document.getElementById("fieldUrl"),
  cancelEdit: document.getElementById("cancelEdit"),

  calendarDialog: document.getElementById("calendarDialog"),
  calendarForm: document.getElementById("calendarForm"),
  calendarKey: document.getElementById("calendarKey"),
  copyCalendarKey: document.getElementById("copyCalendarKey"),
  newCalendarKey: document.getElementById("newCalendarKey"),
};

const state = {
  viewDate: new Date(),
  selectedISO: getTodayISO(),
  calendarId: getOrCreateCalendarId(),
  cache: null,
  cloud: {
    ready: false,
    ok: false,
    lastError: "",
  },
  loadedMonths: new Set(),
  loadSeq: 0,
};

state.cache = loadCache(state.calendarId);

function setCloudPill({ ok, message }) {
  if (!elements.cloudStatus) return;
  elements.cloudStatus.textContent = message;
  elements.cloudStatus.classList.toggle("ok", Boolean(ok));
  elements.cloudStatus.classList.toggle("bad", ok === false);
}

function getEntry(iso) {
  const entry = state.cache.entries?.[iso];
  if (!entry || typeof entry !== "object") return null;
  const title = String(entry.title ?? "").trim();
  const url = normalizeUrl(entry.url ?? "");
  const updatedAt = entry.updatedAt ? String(entry.updatedAt) : null;
  if (!title && !url) return null;
  return { title, url, updatedAt };
}

function setEntryLocal(iso, entryOrNull) {
  if (!state.cache.entries || typeof state.cache.entries !== "object") state.cache.entries = {};
  if (!state.cache.pending || typeof state.cache.pending !== "object") state.cache.pending = {};

  if (!entryOrNull) {
    delete state.cache.entries[iso];
    state.cache.pending[iso] = null;
  } else {
    state.cache.entries[iso] = entryOrNull;
    state.cache.pending[iso] = entryOrNull;
  }

  saveCache(state.calendarId, state.cache);
}

function renderSide() {
  elements.sideDate.textContent = state.selectedISO ? formatSideDate(state.selectedISO) : "Select a day";

  if (!state.selectedISO) {
    elements.sideEmpty.hidden = false;
    elements.sideDetails.hidden = true;
    return;
  }

  const entry = getEntry(state.selectedISO);
  if (!entry) {
    elements.sideEmpty.textContent = "No link saved for this day.";
    elements.sideEmpty.hidden = false;
    elements.sideDetails.hidden = true;
    return;
  }

  elements.sideEmpty.hidden = true;
  elements.sideDetails.hidden = false;
  elements.sideTitle.textContent = entry.title || "(untitled)";
  elements.sideUrl.textContent = entry.url || "(no url)";
  elements.sideUrl.href = entry.url || "#";
  elements.sideUrl.setAttribute("aria-disabled", entry.url ? "false" : "true");
  elements.sideUrl.tabIndex = entry.url ? 0 : -1;
}

function renderCalendar() {
  elements.monthHeading.textContent = formatMonthHeading(state.viewDate);

  const monthPrefix = `${state.viewDate.getFullYear()}-${pad2(state.viewDate.getMonth() + 1)}-`;
  const monthCount = Object.keys(state.cache.entries || {}).filter((k) => k.startsWith(monthPrefix)).length;
  const totalCount = Object.keys(state.cache.entries || {}).length;
  const pendingCount = Object.keys(state.cache.pending || {}).length;
  if (elements.monthStats) {
    elements.monthStats.textContent = `${monthCount} this month • ${totalCount} total${
      pendingCount ? ` • ${pendingCount} pending` : ""
    }`;
  }

  elements.grid.replaceChildren();

  const anchor = getMonthGridAnchor(state.viewDate);
  const monthIndex = state.viewDate.getMonth();
  const todayISO = getTodayISO();

  for (let cellIndex = 0; cellIndex < 42; cellIndex += 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + cellIndex);
    const iso = toISODate(date);
    const isInMonth = date.getMonth() === monthIndex;
    const entry = getEntry(iso);
    const isPending = Object.prototype.hasOwnProperty.call(state.cache.pending || {}, iso);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `day${isInMonth ? "" : " mutedDay"}${entry ? " hasEntry" : ""}${isPending ? " pending" : ""}${
      iso === state.selectedISO ? " selected" : ""
    }${iso === todayISO ? " today" : ""}`;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `${formatSideDate(iso)}${entry ? ", has notes" : ""}${isPending ? ", pending sync" : ""}`);
    button.dataset.iso = iso;

    const top = document.createElement("div");
    top.className = "dayTop";

    const num = document.createElement("div");
    num.className = "dayNum";
    num.textContent = String(date.getDate());
    top.appendChild(num);

    if (entry) {
      const badge = document.createElement("div");
      badge.className = "badge";
      const dot = document.createElement("span");
      dot.className = "dot";
      const label = document.createElement("span");
      label.textContent = "link";
      badge.append(dot, label);
      top.appendChild(badge);
    }

    const title = document.createElement("div");
    title.className = "dayTitle";
    title.textContent = entry?.title || "";

    button.append(top, title);
    button.addEventListener("click", () => {
      state.selectedISO = iso;
      renderSide();
      renderCalendar();
    });
    button.addEventListener("dblclick", () => {
      state.selectedISO = iso;
      openEditDialog(iso);
    });

    elements.grid.appendChild(button);
  }
}

function openEditDialog(iso) {
  state.selectedISO = iso;
  renderSide();
  renderCalendar();

  const entry = getEntry(iso);
  elements.dialogHeading.textContent = `Edit: ${formatSideDate(iso)}`;
  elements.fieldTitle.value = entry?.title ?? "";
  elements.fieldUrl.value = entry?.url ?? "";

  elements.editDialog.showModal();
  setTimeout(() => elements.fieldTitle.focus(), 0);
}

function closeEditDialog() {
  if (elements.editDialog.open) elements.editDialog.close();
}

async function trySyncPending() {
  const pending = state.cache.pending || {};
  const items = Object.entries(pending);
  if (!items.length) return;

  try {
    setCloudPill({ ok: true, message: "Syncing…" });
    const entries = items.map(([date, value]) => ({
      date,
      title: value?.title ?? "",
      url: value?.url ?? "",
    }));
    await fetchJson("/api/entries", {
      method: "POST",
      body: JSON.stringify({ calendarId: state.calendarId, entries }),
    });
    state.cache.pending = {};
    saveCache(state.calendarId, state.cache);
  } catch (error) {
    state.cloud.ok = false;
    state.cloud.lastError = error?.message ?? "Sync failed.";
    setCloudPill({ ok: false, message: "Cloud error" });
  }
}

async function loadMonthFromCloud(date) {
  const month = monthKeyFromDate(date);
  if (state.loadedMonths.has(month)) return;
  const seq = (state.loadSeq += 1);

  try {
    setCloudPill({ ok: true, message: "Loading…" });
    const result = await fetchJson(
      `/api/entries?calendarId=${encodeURIComponent(state.calendarId)}&month=${encodeURIComponent(month)}`,
    );
    if (seq !== state.loadSeq) return;

    for (const entry of result?.entries || []) {
      if (!entry?.date) continue;
      const title = String(entry.title ?? "").trim();
      const url = normalizeUrl(entry.url ?? "");
      const updatedAt = entry.updatedAt ? String(entry.updatedAt) : null;
      if (!title && !url) continue;
      state.cache.entries[entry.date] = { title, url, updatedAt };
    }
    saveCache(state.calendarId, state.cache);
    state.loadedMonths.add(month);

    state.cloud.ok = true;
    setCloudPill({ ok: true, message: "Cloud synced" });
  } catch (error) {
    state.cloud.ok = false;
    state.cloud.lastError = error?.message ?? "Cloud unavailable.";
    setCloudPill({ ok: false, message: "Cloud error" });
  }
}

async function detectCloud() {
  try {
    await fetchJson("/api/health");
    state.cloud.ready = true;
    state.cloud.ok = true;
    setCloudPill({ ok: true, message: "Cloud ready" });
  } catch (error) {
    state.cloud.ready = true;
    state.cloud.ok = false;
    state.cloud.lastError = error?.message ?? "Cloud unavailable.";
    setCloudPill({ ok: false, message: "No cloud" });
  }
}

async function maybeMigrateLegacyLocalData() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  const parsed = safeJsonParse(raw);
  const legacyEntries = parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : null;
  if (!legacyEntries) return;
  const legacyCount = Object.keys(legacyEntries).length;
  if (!legacyCount) return;

  const ok = confirm(
    `Found ${legacyCount} saved day link(s) from an older version.\n\nImport them into your cloud calendar now?`,
  );
  if (!ok) return;

  const entries = Object.entries(legacyEntries)
    .map(([date, value]) => ({
      date,
      title: String(value?.title ?? "").trim(),
      url: normalizeUrl(value?.url),
    }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));

  for (const e of entries) {
    if (!e.title && !e.url) continue;
    state.cache.entries[e.date] = { title: e.title, url: e.url, updatedAt: null };
    state.cache.pending[e.date] = { title: e.title, url: e.url, updatedAt: null };
  }
  saveCache(state.calendarId, state.cache);
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  toast("Imported", "Legacy local data imported. Syncing to cloud…");
  await trySyncPending();
}

async function handleSaveFromDialog() {
  const iso = state.selectedISO;
  const title = String(elements.fieldTitle.value ?? "").trim();
  const url = normalizeUrl(elements.fieldUrl.value ?? "");

  if (!title && !url) {
    setEntryLocal(iso, null);
  } else {
    setEntryLocal(iso, { title, url, updatedAt: new Date().toISOString() });
  }

  closeEditDialog();
  renderSide();
  renderCalendar();

  try {
    await fetchJson("/api/entries", {
      method: "POST",
      body: JSON.stringify({ calendarId: state.calendarId, date: iso, title, url }),
    });
    delete state.cache.pending[iso];
    saveCache(state.calendarId, state.cache);
    state.cloud.ok = true;
    setCloudPill({ ok: true, message: "Cloud synced" });
  } catch (error) {
    state.cloud.ok = false;
    state.cloud.lastError = error?.message ?? "Save failed.";
    setCloudPill({ ok: false, message: "Cloud error" });
    toast("Saved locally", "Cloud save failed; will retry when available.");
  }
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportData() {
  try {
    const body = await fetchJson(`/api/export?calendarId=${encodeURIComponent(state.calendarId)}`);
    downloadJson("link-calendar-export.json", body);
  } catch (error) {
    downloadJson("link-calendar-export.json", { exportedAt: new Date().toISOString(), calendarId: state.calendarId, ...state.cache });
    toast("Exported", "Cloud export failed; exported local cache instead.");
  }
}

async function importDataFromFile(file) {
  const text = await file.text();
  const parsed = safeJsonParse(text);

  const entriesArray = Array.isArray(parsed?.entries)
    ? parsed.entries
    : parsed?.entries && typeof parsed.entries === "object"
      ? Object.entries(parsed.entries).map(([date, v]) => ({ date, ...v }))
      : null;

  if (!entriesArray) throw new Error("Invalid file format.");

  const replace = confirm("Import will MERGE into your current calendar key. Continue?");
  if (!replace) return;

  const toUpsert = [];
  for (const e of entriesArray) {
    const date = String(e?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const title = String(e?.title ?? "").trim();
    const url = normalizeUrl(e?.url);
    if (!title && !url) continue;
    toUpsert.push({ date, title, url });
    state.cache.entries[date] = { title, url, updatedAt: null };
    state.cache.pending[date] = { title, url, updatedAt: null };
  }
  saveCache(state.calendarId, state.cache);

  for (let i = 0; i < toUpsert.length; i += 500) {
    const chunk = toUpsert.slice(i, i + 500);
    await fetchJson("/api/entries", { method: "POST", body: JSON.stringify({ calendarId: state.calendarId, entries: chunk }) });
  }

  state.cache.pending = {};
  saveCache(state.calendarId, state.cache);
}

function openCalendarDialog() {
  elements.calendarKey.value = state.calendarId;
  elements.calendarDialog.showModal();
  setTimeout(() => elements.calendarKey.select(), 0);
}

function closeCalendarDialog() {
  if (elements.calendarDialog.open) elements.calendarDialog.close();
}

async function useCalendarId(nextId) {
  const trimmed = String(nextId ?? "").trim();
  if (trimmed.length < 10) {
    toast("Calendar key", "That key looks too short.");
    return;
  }

  state.calendarId = trimmed;
  localStorage.setItem(CALENDAR_ID_KEY, state.calendarId);
  state.cache = loadCache(state.calendarId);
  state.loadedMonths = new Set();

  renderSide();
  renderCalendar();

  await detectCloud();
  await loadMonthFromCloud(state.viewDate);
  await trySyncPending();
}

function wireEvents() {
  elements.prevMonth.addEventListener("click", async () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    renderCalendar();
    await loadMonthFromCloud(state.viewDate);
  });
  elements.nextMonth.addEventListener("click", async () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    renderCalendar();
    await loadMonthFromCloud(state.viewDate);
  });
  elements.today.addEventListener("click", async () => {
    const now = new Date();
    state.viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
    state.selectedISO = toISODate(now);
    renderSide();
    renderCalendar();
    await loadMonthFromCloud(state.viewDate);
  });

  elements.exportData.addEventListener("click", exportData);
  elements.importFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importDataFromFile(file);
      renderSide();
      renderCalendar();
      toast("Imported", "Import complete and synced.");
    } catch (error) {
      alert(error?.message ?? "Import failed.");
    }
  });

  elements.manageCalendar.addEventListener("click", openCalendarDialog);

  elements.copyCalendarKey.addEventListener("click", async () => {
    await navigator.clipboard.writeText(String(elements.calendarKey.value ?? ""));
    toast("Copied", "Calendar key copied to clipboard.");
  });
  elements.newCalendarKey.addEventListener("click", () => {
    const generated = crypto?.randomUUID ? crypto.randomUUID() : `cal_${Date.now()}_${Math.random()}`;
    elements.calendarKey.value = generated;
    elements.calendarKey.select();
  });
  elements.calendarForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = elements.calendarKey.value;
    closeCalendarDialog();
    await useCalendarId(next);
  });

  elements.editSelected.addEventListener("click", () => {
    if (!state.selectedISO) return;
    openEditDialog(state.selectedISO);
  });

  elements.clearSelected.addEventListener("click", () => {
    if (!state.selectedISO) return;
    const ok = confirm(`Clear link for ${formatSideDate(state.selectedISO)}?`);
    if (!ok) return;
    setEntryLocal(state.selectedISO, null);
    renderSide();
    renderCalendar();
    trySyncPending();
  });

  elements.sideUrl.addEventListener("click", (event) => {
    if (!elements.sideUrl.href || elements.sideUrl.href.endsWith("#")) event.preventDefault();
  });

  elements.cancelEdit.addEventListener("click", closeEditDialog);
  elements.editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSaveFromDialog();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
      if (!state.selectedISO) return;
      event.preventDefault();
      openEditDialog(state.selectedISO);
    }
  });

  window.addEventListener("online", () => {
    toast("Online", "Trying to sync pending changes…");
    detectCloud().then(() => trySyncPending());
  });
}

wireEvents();
renderSide();
renderCalendar();

await detectCloud();
await maybeMigrateLegacyLocalData();
await loadMonthFromCloud(state.viewDate);
await trySyncPending();
