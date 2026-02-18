"use strict";

const ENCRYPTED_NOTES_KEY = "journal.notes.encrypted.v1";
const LEGACY_STORAGE_KEY = "journal.notes.v1";
const AUTO_LOCK_KEY = "journal.crypto.auto_lock_ms.v1";
const KEY_CHECK_KEY = "journal.crypto.key_check.v1";
const KEY_CHECK_SENTINEL = "journal-key-check-v1";
const BACKUP_VERSION = 1;
const AUTOSAVE_DELAY_MS = 250;
const DEFAULT_AUTO_LOCK_MS = 300000;
const ALLOWED_AUTO_LOCK_MS = new Set([0, 60000, 300000, 900000, 1800000]);

const elements = {
  newNoteBtn: document.getElementById("new-note-btn"),
  deleteNoteBtn: document.getElementById("delete-note-btn"),
  openSettingsBtn: document.getElementById("open-settings-btn"),
  openSettingsOverlayBtn: document.getElementById("open-settings-overlay-btn"),
  lockedOverlayMessage: document.getElementById("locked-overlay-message"),
  closeSettingsBtn: document.getElementById("close-settings-btn"),
  settingsView: document.getElementById("settings-view"),
  settingsBackdrop: document.getElementById("settings-backdrop"),
  lockedOverlay: document.getElementById("locked-overlay"),
  searchInput: document.getElementById("search-input"),
  noteList: document.getElementById("note-list"),
  noteTitleInput: document.getElementById("note-title-input"),
  noteContentInput: document.getElementById("note-content-input"),
  previewOutput: document.getElementById("preview-output"),
  passphraseInput: document.getElementById("passphrase-input"),
  setupConfirmWrap: document.getElementById("setup-confirm-wrap"),
  passphraseConfirmInput: document.getElementById("passphrase-confirm-input"),
  unlockBtn: document.getElementById("unlock-btn"),
  lockBtn: document.getElementById("lock-btn"),
  cryptoStatus: document.getElementById("crypto-status"),
  autoLockSelect: document.getElementById("auto-lock-select"),
  exportBackupBtn: document.getElementById("export-backup-btn"),
  importBackupBtn: document.getElementById("import-backup-btn"),
  importBackupInput: document.getElementById("import-backup-input"),
  backupStatus: document.getElementById("backup-status"),
};

const state = {
  notes: [],
  selectedId: null,
  searchQuery: "",
  crypto: {
    key: null,
    keyParams: null,
    keyCheckRecord: null,
    hasPassphrase: false,
    statusText: "Locked",
    unlocking: false,
    autoLockMs: DEFAULT_AUTO_LOCK_MS,
    idleTimerId: null,
  },
};

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeAutoLockMs(value) {
  const candidate = Number(value);
  return ALLOWED_AUTO_LOCK_MS.has(candidate) ? candidate : DEFAULT_AUTO_LOCK_MS;
}

function loadAutoLockPreference() {
  const raw = localStorage.getItem(AUTO_LOCK_KEY);
  state.crypto.autoLockMs = normalizeAutoLockMs(raw);
}

function persistAutoLockPreference() {
  localStorage.setItem(AUTO_LOCK_KEY, String(state.crypto.autoLockMs));
}

function isValidKeyCheckRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.saltB64 === "string" &&
    Number.isInteger(record.iterations) &&
    record.check &&
    typeof record.check === "object" &&
    typeof record.check.ivB64 === "string" &&
    typeof record.check.ciphertextB64 === "string"
  );
}

function loadKeyCheckRecord() {
  const raw = localStorage.getItem(KEY_CHECK_KEY);
  const parsed = safeJsonParse(raw, null);
  if (isValidKeyCheckRecord(parsed)) {
    state.crypto.keyCheckRecord = parsed;
    state.crypto.hasPassphrase = true;
    state.crypto.statusText = "Locked";
    return;
  }
  state.crypto.keyCheckRecord = null;
  state.crypto.hasPassphrase = false;
  state.crypto.statusText = "Set passphrase to start";
}

function persistKeyCheckRecord(record) {
  localStorage.setItem(KEY_CHECK_KEY, JSON.stringify(record));
}

function normalizeNote(rawNote) {
  return {
    id: String(rawNote.id || uid()),
    title: String(rawNote.title || ""),
    content: String(rawNote.content || ""),
    updatedAt: String(rawNote.updatedAt || nowIso()),
  };
}

function normalizeNotesArray(rawNotes) {
  if (!Array.isArray(rawNotes)) {
    return [];
  }
  return rawNotes.filter((n) => n && typeof n === "object").map(normalizeNote);
}

function isValidEncryptedNotesRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    record.payload &&
    typeof record.payload === "object" &&
    typeof record.payload.ivB64 === "string" &&
    typeof record.payload.ciphertextB64 === "string"
  );
}

function loadEncryptedNotesRecord() {
  const raw = localStorage.getItem(ENCRYPTED_NOTES_KEY);
  const parsed = safeJsonParse(raw, null);
  return isValidEncryptedNotesRecord(parsed) ? parsed : null;
}

function isValidBackupPayload(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    payload.version === BACKUP_VERSION &&
    isValidKeyCheckRecord(payload.keyCheck) &&
    isValidEncryptedNotesRecord(payload.encryptedNotes)
  );
}

function setBackupStatus(message, isError = false) {
  elements.backupStatus.textContent = message;
  elements.backupStatus.classList.toggle("error", isError);
}

function loadLegacyPlaintextNotes() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  return normalizeNotesArray(parsed);
}

async function persistNotes() {
  if (!isUnlocked() || !state.crypto.key || !window.JournalCrypto) {
    return;
  }
  const plaintext = JSON.stringify(state.notes);
  const payload = await window.JournalCrypto.encryptString(plaintext, state.crypto.key);
  const record = {
    version: 1,
    updatedAt: nowIso(),
    payload,
  };
  localStorage.setItem(ENCRYPTED_NOTES_KEY, JSON.stringify(record));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function persistNotesSafe() {
  persistNotes().catch((error) => {
    console.error(error);
    state.crypto.statusText = "Save failed";
    renderCryptoState();
  });
}

function resetSessionNotes() {
  state.notes = [];
  state.selectedId = null;
  state.searchQuery = "";
  elements.searchInput.value = "";
}

async function loadNotesForActiveSession() {
  if (!isUnlocked() || !state.crypto.key || !window.JournalCrypto) {
    return;
  }

  const encryptedRecord = loadEncryptedNotesRecord();
  if (encryptedRecord) {
    let plaintextNotes = "";
    try {
      plaintextNotes = await window.JournalCrypto.decryptString(
        encryptedRecord.payload,
        state.crypto.key
      );
    } catch {
      throw new Error("Encrypted notes unreadable");
    }
    const parsedNotes = safeJsonParse(plaintextNotes, []);
    if (!Array.isArray(parsedNotes)) {
      throw new Error("Encrypted notes unreadable");
    }
    state.notes = normalizeNotesArray(parsedNotes);
  } else {
    const legacyNotes = loadLegacyPlaintextNotes();
    state.notes = legacyNotes;
    await persistNotes();
  }

  if (state.notes.length === 0) {
    state.notes = [normalizeNote({ title: "Untitled", content: "" })];
    state.selectedId = state.notes[0].id;
    await persistNotes();
  } else if (!state.selectedId || !state.notes.some((note) => note.id === state.selectedId)) {
    state.selectedId = state.notes[0].id;
  }
}

function createNote() {
  const note = normalizeNote({ title: "Untitled", content: "" });
  state.notes.unshift(note);
  state.selectedId = note.id;
  persistNotesSafe();
  render();
}

function getSelectedNote() {
  return state.notes.find((note) => note.id === state.selectedId) || null;
}

function flushEditorIntoSelectedNote() {
  if (!isUnlocked()) {
    return;
  }
  const note = getSelectedNote();
  if (!note) {
    return;
  }
  note.title = elements.noteTitleInput.value.trim() || "Untitled";
  note.content = elements.noteContentInput.value;
  note.updatedAt = nowIso();
}

function deleteSelectedNote() {
  if (state.notes.length <= 1) {
    return;
  }
  state.notes = state.notes.filter((note) => note.id !== state.selectedId);
  state.selectedId = state.notes[0].id;
  persistNotesSafe();
  render();
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(url) {
  const trimmed = url.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("#")
  ) {
    return trimmed;
  }
  return "#";
}

function applyInlineMarkdown(text) {
  let output = text;
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeUrl(href);
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return output;
}

function renderMarkdown(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split(/\r?\n/);
  const html = [];
  let inList = false;
  let inCode = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      html.push(inCode ? "<pre><code>" : "</code></pre>");
      continue;
    }

    if (inCode) {
      html.push(`${line}\n`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      const level = headingMatch[1].length;
      const text = applyInlineMarkdown(headingMatch[2]);
      html.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${applyInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    if (line.trim() === "") {
      html.push("<p></p>");
      continue;
    }

    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  if (inList) {
    html.push("</ul>");
  }
  if (inCode) {
    html.push("</code></pre>");
  }
  return html.join("\n");
}

function renderNoteList() {
  elements.noteList.innerHTML = "";
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = query
    ? state.notes.filter((note) => {
        const haystack = `${note.title}\n${note.content}`.toLowerCase();
        return haystack.includes(query);
      })
    : state.notes;

  for (const note of filtered) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = note.id === state.selectedId ? "active" : "";
    button.dataset.noteId = note.id;

    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = note.title || "Untitled";

    const meta = document.createElement("span");
    meta.className = "note-meta";
    meta.textContent = formatDate(note.updatedAt);

    button.appendChild(title);
    button.appendChild(meta);
    item.appendChild(button);
    elements.noteList.appendChild(item);
  }
}

function renderEditor() {
  const note = getSelectedNote();
  if (!note) {
    elements.noteTitleInput.value = "";
    elements.noteContentInput.value = "";
    elements.previewOutput.innerHTML = "";
    return;
  }
  elements.noteTitleInput.value = note.title;
  elements.noteContentInput.value = note.content;
  elements.previewOutput.innerHTML = renderMarkdown(note.content);
}

function isUnlocked() {
  return Boolean(state.crypto.key);
}

function clearIdleAutoLockTimer() {
  if (state.crypto.idleTimerId !== null) {
    clearTimeout(state.crypto.idleTimerId);
    state.crypto.idleTimerId = null;
  }
}

function scheduleIdleAutoLock() {
  clearIdleAutoLockTimer();
  if (!isUnlocked() || state.crypto.autoLockMs <= 0) {
    return;
  }
  state.crypto.idleTimerId = setTimeout(() => {
    lockCryptoSession("Locked (idle timeout)");
  }, state.crypto.autoLockMs);
}

function touchCryptoActivity() {
  if (!isUnlocked()) {
    return;
  }
  scheduleIdleAutoLock();
}

function renderCryptoState() {
  const needsSetup = !state.crypto.hasPassphrase;
  elements.cryptoStatus.textContent = state.crypto.statusText;
  elements.cryptoStatus.classList.toggle("unlocked", isUnlocked());
  elements.cryptoStatus.classList.toggle("locked", !isUnlocked());
  elements.setupConfirmWrap.classList.toggle("hidden", !needsSetup);
  elements.passphraseInput.placeholder = needsSetup
    ? "Create a passphrase (min 8 chars)"
    : "Enter passphrase to unlock";
  elements.unlockBtn.textContent = needsSetup ? "Set Passphrase" : "Unlock";
  elements.unlockBtn.disabled = state.crypto.unlocking || isUnlocked();
  elements.lockBtn.disabled = !isUnlocked();
  elements.closeSettingsBtn.disabled = needsSetup;
  elements.exportBackupBtn.disabled = state.crypto.unlocking || !state.crypto.hasPassphrase;
  elements.importBackupBtn.disabled = state.crypto.unlocking;
  elements.autoLockSelect.value = String(state.crypto.autoLockMs);
}

function render() {
  const locked = !isUnlocked();
  const needsSetup = !state.crypto.hasPassphrase;

  document.body.classList.toggle("app-locked", locked);
  elements.lockedOverlay.classList.toggle("hidden", !locked);
  elements.lockedOverlayMessage.textContent = needsSetup
    ? "Set a passphrase in Settings to start."
    : "Unlock in Settings to view and edit notes.";
  elements.searchInput.value = state.searchQuery;
  elements.searchInput.disabled = locked;
  elements.noteTitleInput.disabled = locked;
  elements.noteContentInput.disabled = locked;
  elements.newNoteBtn.disabled = locked;

  if (locked) {
    elements.noteList.innerHTML = "";
    elements.noteTitleInput.value = "";
    elements.noteContentInput.value = "";
    elements.previewOutput.innerHTML = "<p class=\"muted\">Locked.</p>";
  } else {
    renderNoteList();
    renderEditor();
  }

  renderCryptoState();
  elements.deleteNoteBtn.disabled = locked || state.notes.length <= 1;
}

function openSettings() {
  elements.settingsView.classList.remove("hidden");
  elements.settingsView.setAttribute("aria-hidden", "false");
  elements.passphraseInput.focus();
}

function closeSettings() {
  if (!state.crypto.hasPassphrase) {
    return;
  }
  elements.settingsView.classList.add("hidden");
  elements.settingsView.setAttribute("aria-hidden", "true");
  elements.openSettingsBtn.focus();
}

function lockCryptoSession(reasonText = "Locked") {
  state.crypto.key = null;
  state.crypto.keyParams = null;
  state.crypto.unlocking = false;
  state.crypto.statusText = reasonText;
  elements.passphraseInput.value = "";
  elements.passphraseConfirmInput.value = "";
  clearIdleAutoLockTimer();
  resetSessionNotes();
  render();
}

async function unlockCryptoSession() {
  if (state.crypto.unlocking || isUnlocked()) {
    return;
  }

  const passphrase = elements.passphraseInput.value;
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    state.crypto.statusText = "Use at least 8 characters";
    renderCryptoState();
    return;
  }

  if (!window.JournalCrypto) {
    state.crypto.statusText = "Crypto module unavailable";
    renderCryptoState();
    return;
  }

  state.crypto.unlocking = true;
  state.crypto.statusText = "Unlocking...";
  renderCryptoState();

  try {
    if (!state.crypto.hasPassphrase) {
      const confirmation = elements.passphraseConfirmInput.value;
      if (passphrase !== confirmation) {
        throw new Error("Passphrases do not match");
      }

      const setupResult = await window.JournalCrypto.deriveSessionKey(passphrase);
      const checkPayload = await window.JournalCrypto.encryptString(
        KEY_CHECK_SENTINEL,
        setupResult.key
      );
      const keyCheckRecord = {
        version: 1,
        saltB64: setupResult.params.saltB64,
        iterations: setupResult.params.iterations,
        check: checkPayload,
      };
      persistKeyCheckRecord(keyCheckRecord);
      state.crypto.keyCheckRecord = keyCheckRecord;
      state.crypto.hasPassphrase = true;
      state.crypto.key = setupResult.key;
      state.crypto.keyParams = setupResult.params;
      await loadNotesForActiveSession();
      state.crypto.statusText = "Unlocked";
      elements.passphraseInput.value = "";
      elements.passphraseConfirmInput.value = "";
      scheduleIdleAutoLock();
      return;
    }

    const keyCheckRecord = state.crypto.keyCheckRecord;
    if (!isValidKeyCheckRecord(keyCheckRecord)) {
      throw new Error("Passphrase record missing");
    }

    const unlockResult = await window.JournalCrypto.deriveSessionKey(passphrase, {
      saltB64: keyCheckRecord.saltB64,
      iterations: keyCheckRecord.iterations,
    });
    const checkPlaintext = await window.JournalCrypto.decryptString(
      keyCheckRecord.check,
      unlockResult.key
    );
    if (checkPlaintext !== KEY_CHECK_SENTINEL) {
      throw new Error("Wrong passphrase");
    }

    state.crypto.key = unlockResult.key;
    state.crypto.keyParams = unlockResult.params;
    await loadNotesForActiveSession();
    state.crypto.statusText = "Unlocked";
    elements.passphraseInput.value = "";
    scheduleIdleAutoLock();
  } catch (error) {
    console.error(error);
    if (error && error.message === "Passphrases do not match") {
      state.crypto.statusText = "Passphrases do not match";
    } else if (error && error.message === "Passphrase record missing") {
      state.crypto.statusText = "Passphrase setup required";
    } else if (error && error.message === "Encrypted notes unreadable") {
      state.crypto.statusText = "Encrypted data unreadable";
    } else if (state.crypto.hasPassphrase) {
      state.crypto.statusText = "Wrong passphrase";
    } else {
      state.crypto.statusText = "Unlock failed";
    }
    state.crypto.key = null;
    state.crypto.keyParams = null;
  } finally {
    state.crypto.unlocking = false;
    render();
  }
}

function makeBackupFilename() {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `journal-backup-${timestamp}.json`;
}

async function exportEncryptedBackup() {
  if (!state.crypto.hasPassphrase) {
    setBackupStatus("Set a passphrase before exporting a backup.", true);
    return;
  }

  try {
    if (isUnlocked()) {
      flushEditorIntoSelectedNote();
      await persistNotes();
    }

    const keyCheckRecord = state.crypto.keyCheckRecord;
    const encryptedNotesRecord = loadEncryptedNotesRecord();
    if (!isValidKeyCheckRecord(keyCheckRecord) || !isValidEncryptedNotesRecord(encryptedNotesRecord)) {
      setBackupStatus("No encrypted note data found to export.", true);
      return;
    }

    const backupPayload = {
      version: BACKUP_VERSION,
      exportedAt: nowIso(),
      keyCheck: keyCheckRecord,
      encryptedNotes: encryptedNotesRecord,
      autoLockMs: state.crypto.autoLockMs,
    };
    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = makeBackupFilename();
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setBackupStatus("Encrypted backup exported.");
  } catch (error) {
    console.error(error);
    setBackupStatus("Backup export failed.", true);
  }
}

async function importEncryptedBackupFromFile(file) {
  if (!file) {
    return;
  }

  try {
    const raw = await file.text();
    const parsed = safeJsonParse(raw, null);
    if (!isValidBackupPayload(parsed)) {
      setBackupStatus("Invalid backup file.", true);
      return;
    }

    const shouldImport = window.confirm(
      "Importing this backup will replace your current local encrypted notes. Continue?"
    );
    if (!shouldImport) {
      setBackupStatus("Import canceled.");
      return;
    }

    localStorage.setItem(KEY_CHECK_KEY, JSON.stringify(parsed.keyCheck));
    localStorage.setItem(ENCRYPTED_NOTES_KEY, JSON.stringify(parsed.encryptedNotes));
    localStorage.removeItem(LEGACY_STORAGE_KEY);

    state.crypto.keyCheckRecord = parsed.keyCheck;
    state.crypto.hasPassphrase = true;
    state.crypto.autoLockMs = normalizeAutoLockMs(parsed.autoLockMs);
    persistAutoLockPreference();

    lockCryptoSession("Backup imported. Unlock required");
    openSettings();
    setBackupStatus("Backup imported. Unlock to access notes.");
  } catch (error) {
    console.error(error);
    setBackupStatus("Backup import failed.", true);
  } finally {
    elements.importBackupInput.value = "";
  }
}

const saveEditorChanges = debounce(() => {
  if (!isUnlocked()) {
    return;
  }
  const note = getSelectedNote();
  if (!note) {
    return;
  }
  note.title = elements.noteTitleInput.value.trim() || "Untitled";
  note.content = elements.noteContentInput.value;
  note.updatedAt = nowIso();
  persistNotesSafe();
  render();
}, AUTOSAVE_DELAY_MS);

function wireEvents() {
  elements.newNoteBtn.addEventListener("click", () => {
    if (!isUnlocked()) {
      return;
    }
    createNote();
  });

  elements.deleteNoteBtn.addEventListener("click", () => {
    if (!isUnlocked()) {
      return;
    }
    deleteSelectedNote();
  });

  elements.openSettingsBtn.addEventListener("click", () => {
    openSettings();
  });

  elements.openSettingsOverlayBtn.addEventListener("click", () => {
    openSettings();
  });

  elements.closeSettingsBtn.addEventListener("click", () => {
    closeSettings();
  });

  elements.settingsBackdrop.addEventListener("click", () => {
    closeSettings();
  });

  elements.searchInput.addEventListener("input", (event) => {
    if (!isUnlocked()) {
      return;
    }
    state.searchQuery = event.target.value;
    renderNoteList();
  });

  elements.noteList.addEventListener("click", (event) => {
    if (!isUnlocked()) {
      return;
    }
    const button = event.target.closest("button[data-note-id]");
    if (!button) {
      return;
    }
    state.selectedId = button.dataset.noteId;
    render();
  });

  elements.noteTitleInput.addEventListener("input", () => {
    if (!isUnlocked()) {
      return;
    }
    saveEditorChanges();
  });

  elements.noteContentInput.addEventListener("input", () => {
    if (!isUnlocked()) {
      return;
    }
    const note = getSelectedNote();
    if (!note) {
      return;
    }
    elements.previewOutput.innerHTML = renderMarkdown(elements.noteContentInput.value);
    saveEditorChanges();
  });

  elements.unlockBtn.addEventListener("click", () => {
    unlockCryptoSession();
  });

  elements.lockBtn.addEventListener("click", () => {
    lockCryptoSession("Locked");
  });

  elements.exportBackupBtn.addEventListener("click", () => {
    exportEncryptedBackup();
  });

  elements.importBackupBtn.addEventListener("click", () => {
    elements.importBackupInput.click();
  });

  elements.importBackupInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    importEncryptedBackupFromFile(file);
  });

  elements.passphraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockCryptoSession();
    }
  });

  elements.passphraseConfirmInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockCryptoSession();
    }
  });

  elements.autoLockSelect.addEventListener("change", (event) => {
    state.crypto.autoLockMs = normalizeAutoLockMs(event.target.value);
    persistAutoLockPreference();
    if (isUnlocked()) {
      scheduleIdleAutoLock();
    }
    state.crypto.statusText = isUnlocked() ? "Unlocked" : "Locked";
    renderCryptoState();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.settingsView.classList.contains("hidden")) {
      closeSettings();
    }
    touchCryptoActivity();
  });

  document.addEventListener("pointerdown", () => {
    touchCryptoActivity();
  });

  document.addEventListener("input", () => {
    touchCryptoActivity();
  });
}

function init() {
  loadAutoLockPreference();
  loadKeyCheckRecord();
  wireEvents();
  render();
  if (!state.crypto.hasPassphrase) {
    openSettings();
  }
}

init();
