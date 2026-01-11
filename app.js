const STORAGE_KEY = "linkCalendar.v1";

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

function normalizeUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  try {
    const asUrl = new URL(trimmed);
    return asUrl.toString();
  } catch {
    // Allow users to paste without scheme.
    try {
      const asUrl = new URL(`https://${trimmed}`);
      return asUrl.toString();
    } catch {
      return "";
    }
  }
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { entries: {} };
    if (!parsed.entries || typeof parsed.entries !== "object") return { entries: {} };
    return { entries: parsed.entries };
  } catch {
    return { entries: {} };
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function formatMonthHeading(date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function formatSideDate(iso) {
  const date = parseISODate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(
    date,
  );
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

const elements = {
  monthHeading: document.getElementById("monthHeading"),
  grid: document.getElementById("grid"),
  prevMonth: document.getElementById("prevMonth"),
  nextMonth: document.getElementById("nextMonth"),
  today: document.getElementById("today"),
  exportData: document.getElementById("exportData"),
  importFile: document.getElementById("importFile"),

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
};

const state = {
  viewDate: new Date(),
  selectedISO: "",
  store: loadStore(),
};

function getEntry(iso) {
  const entry = state.store.entries?.[iso];
  if (!entry || typeof entry !== "object") return null;
  const title = String(entry.title ?? "").trim();
  const url = normalizeUrl(entry.url ?? "");
  if (!title && !url) return null;
  return { title, url };
}

function setEntry(iso, entry) {
  if (!state.store.entries || typeof state.store.entries !== "object") state.store.entries = {};
  if (!entry) {
    delete state.store.entries[iso];
  } else {
    state.store.entries[iso] = entry;
  }
  saveStore(state.store);
}

function renderSide() {
  if (!state.selectedISO) {
    elements.sideDate.textContent = "Select a day";
    elements.sideEmpty.hidden = false;
    elements.sideDetails.hidden = true;
    return;
  }

  elements.sideDate.textContent = formatSideDate(state.selectedISO);
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
  elements.grid.replaceChildren();

  const anchor = getMonthGridAnchor(state.viewDate);
  const monthIndex = state.viewDate.getMonth();
  const todayISO = getTodayISO();

  for (let cellIndex = 0; cellIndex < 42; cellIndex += 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + cellIndex);
    const iso = toISODate(date);
    const isInMonth = date.getMonth() === monthIndex;
    const entry = getEntry(iso);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `day${isInMonth ? "" : " mutedDay"}${iso === state.selectedISO ? " selected" : ""}${
      iso === todayISO ? " today" : ""
    }`;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `${formatSideDate(iso)}${entry ? ", has link" : ""}`);
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

function handleSaveFromDialog() {
  const title = String(elements.fieldTitle.value ?? "").trim();
  const url = normalizeUrl(elements.fieldUrl.value ?? "");
  if (!title && !url) {
    setEntry(state.selectedISO, null);
  } else {
    setEntry(state.selectedISO, { title, url });
  }
  closeEditDialog();
  renderSide();
  renderCalendar();
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

function exportData() {
  downloadJson("link-calendar-export.json", { exportedAt: new Date().toISOString(), ...state.store });
}

async function importDataFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.entries || typeof parsed.entries !== "object") {
    throw new Error("Invalid file format.");
  }

  const replace = confirm("Import will REPLACE your current saved links for any matching dates. Continue?");
  if (!replace) return;

  const next = loadStore();
  next.entries = { ...(next.entries || {}), ...(parsed.entries || {}) };
  state.store = next;
  saveStore(state.store);
}

function wireEvents() {
  elements.prevMonth.addEventListener("click", () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    renderCalendar();
  });
  elements.nextMonth.addEventListener("click", () => {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    renderCalendar();
  });
  elements.today.addEventListener("click", () => {
    const now = new Date();
    state.viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
    state.selectedISO = toISODate(now);
    renderSide();
    renderCalendar();
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
    } catch (error) {
      alert(error?.message ?? "Import failed.");
    }
  });

  elements.editSelected.addEventListener("click", () => {
    if (!state.selectedISO) return;
    openEditDialog(state.selectedISO);
  });

  elements.clearSelected.addEventListener("click", () => {
    if (!state.selectedISO) return;
    const ok = confirm(`Clear link for ${formatSideDate(state.selectedISO)}?`);
    if (!ok) return;
    setEntry(state.selectedISO, null);
    renderSide();
    renderCalendar();
  });

  elements.sideUrl.addEventListener("click", (event) => {
    if (!elements.sideUrl.href || elements.sideUrl.href.endsWith("#")) {
      event.preventDefault();
    }
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
}

wireEvents();
state.selectedISO = getTodayISO();
renderSide();
renderCalendar();

