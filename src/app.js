"use strict";

const ENCRYPTED_NOTES_FALLBACK_KEY = "journal.notes.encrypted.v2";
const NOTES_DB_NAME = "journal.notes.db.v1";
const NOTES_DB_VERSION = 1;
const NOTES_DB_STORE = "records";
const ENCRYPTED_NOTES_RECORD_ID = "encrypted-notes";
const SYNC_ENDPOINT_KEY = "journal.sync.endpoint.v1";
const SYNC_META_KEY = "journal.sync.meta.v1";
const AUTO_LOCK_KEY = "journal.crypto.auto_lock_ms.v1";
const SIDEBAR_COLLAPSED_KEY = "journal.ui.sidebar_collapsed.v1";
const PREVIEW_VISIBLE_KEY = "journal.ui.preview_visible.v1";
const KEY_CHECK_KEY = "journal.crypto.key_check.v1";
const KEY_CHECK_SENTINEL = "journal-key-check-v1";
const BACKUP_VERSION = 1;
const AUTOSAVE_DELAY_MS = 250;
const DEFAULT_AUTO_LOCK_MS = 300000;
const ALLOWED_AUTO_LOCK_MS = new Set([0, 60000, 300000, 900000, 1800000]);
const LOCAL_DATA_KEYS = Object.freeze([KEY_CHECK_KEY, AUTO_LOCK_KEY, SYNC_ENDPOINT_KEY, SYNC_META_KEY]);

const elements = {
  toggleSidebarBtn: document.getElementById("toggle-sidebar-btn"),
  newNoteBtn: document.getElementById("new-note-btn"),
  deleteNoteBtn: document.getElementById("delete-note-btn"),
  openSettingsBtn: document.getElementById("open-settings-btn"),
  openSettingsOverlayBtn: document.getElementById("open-settings-overlay-btn"),
  deleteConfirmView: document.getElementById("delete-confirm-view"),
  deleteConfirmBackdrop: document.getElementById("delete-confirm-backdrop"),
  deleteConfirmNoteTitle: document.getElementById("delete-confirm-note-title"),
  deleteConfirmCancelBtn: document.getElementById("delete-confirm-cancel-btn"),
  deleteConfirmConfirmBtn: document.getElementById("delete-confirm-confirm-btn"),
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
  changePassphraseWrap: document.getElementById("change-passphrase-wrap"),
  currentPassphraseInput: document.getElementById("current-passphrase-input"),
  newPassphraseInput: document.getElementById("new-passphrase-input"),
  newPassphraseConfirmInput: document.getElementById("new-passphrase-confirm-input"),
  changePassphraseBtn: document.getElementById("change-passphrase-btn"),
  changePassphraseStatus: document.getElementById("change-passphrase-status"),
  exportBackupBtn: document.getElementById("export-backup-btn"),
  importBackupBtn: document.getElementById("import-backup-btn"),
  importBackupInput: document.getElementById("import-backup-input"),
  backupStatus: document.getElementById("backup-status"),
  wipeLocalDataBtn: document.getElementById("wipe-local-data-btn"),
  wipeLocalDataStatus: document.getElementById("wipe-local-data-status"),
  syncEndpointInput: document.getElementById("sync-endpoint-input"),
  syncNowBtn: document.getElementById("sync-now-btn"),
  syncStatus: document.getElementById("sync-status"),
  syncConflictWrap: document.getElementById("sync-conflict-wrap"),
  syncConflictText: document.getElementById("sync-conflict-text"),
  syncUseLocalBtn: document.getElementById("sync-use-local-btn"),
  syncUseServerBtn: document.getElementById("sync-use-server-btn"),
};
const togglePreviewBtn = document.getElementById("toggle-preview-btn");
let previewVisible = true;

const state = {
  notes: [],
  selectedId: null,
  searchQuery: "",
  ui: {
    sidebarCollapsed: false,
  },
  crypto: {
    key: null,
    keyParams: null,
    keyCheckRecord: null,
    hasPassphrase: false,
    statusText: "Locked",
    unlocking: false,
    rotating: false,
    wiping: false,
    autoLockMs: DEFAULT_AUTO_LOCK_MS,
    idleTimerId: null,
  },
  sync: {
    endpoint: "",
    statusText: "Sync not configured.",
    busy: false,
    deviceId: null,
    knownServerRevision: null,
    lastSyncedLocalRevision: null,
    lastSyncedAt: null,
    pendingConflict: null,
  },
};

function wrapIdbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function wrapIdbTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function openNotesDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(NOTES_DB_NAME, NOTES_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(NOTES_DB_STORE)) {
        database.createObjectStore(NOTES_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function createEncryptedNotesStorage() {
  let backend = "indexedDB";
  let dbPromise = null;

  function useLocalStorageFallback(error) {
    if (backend !== "localStorage") {
      console.warn("Falling back to localStorage for notes persistence.", error);
      backend = "localStorage";
    }
  }

  async function getDatabase() {
    if (backend === "localStorage") {
      return null;
    }
    if (!dbPromise) {
      dbPromise = openNotesDatabase().catch((error) => {
        useLocalStorageFallback(error);
        return null;
      });
    }
    const database = await dbPromise;
    if (!database) {
      backend = "localStorage";
    }
    return database;
  }

  async function readFromIndexedDb() {
    const database = await getDatabase();
    if (!database) {
      return null;
    }
    const transaction = database.transaction(NOTES_DB_STORE, "readonly");
    const store = transaction.objectStore(NOTES_DB_STORE);
    const record = await wrapIdbRequest(store.get(ENCRYPTED_NOTES_RECORD_ID));
    return record && typeof record === "object" ? record.value || null : null;
  }

  async function writeToIndexedDb(value) {
    const database = await getDatabase();
    if (!database) {
      return false;
    }
    const transaction = database.transaction(NOTES_DB_STORE, "readwrite");
    const store = transaction.objectStore(NOTES_DB_STORE);
    await wrapIdbRequest(
      store.put({
        id: ENCRYPTED_NOTES_RECORD_ID,
        value,
      })
    );
    await wrapIdbTransaction(transaction);
    return true;
  }

  async function clearIndexedDbRecord() {
    const database = await getDatabase();
    if (!database) {
      return false;
    }
    const transaction = database.transaction(NOTES_DB_STORE, "readwrite");
    const store = transaction.objectStore(NOTES_DB_STORE);
    await wrapIdbRequest(store.delete(ENCRYPTED_NOTES_RECORD_ID));
    await wrapIdbTransaction(transaction);
    return true;
  }

  return {
    async getEncryptedNotesRecord() {
      if (backend === "indexedDB") {
        try {
          const value = await readFromIndexedDb();
          return isValidEncryptedNotesRecord(value) ? value : null;
        } catch (error) {
          useLocalStorageFallback(error);
        }
      }

      const fallbackRaw = localStorage.getItem(ENCRYPTED_NOTES_FALLBACK_KEY);
      const fallbackParsed = safeJsonParse(fallbackRaw, null);
      return isValidEncryptedNotesRecord(fallbackParsed) ? fallbackParsed : null;
    },

    async setEncryptedNotesRecord(record) {
      if (backend === "indexedDB") {
        try {
          const wroteToIndexedDb = await writeToIndexedDb(record);
          if (wroteToIndexedDb) {
            localStorage.removeItem(ENCRYPTED_NOTES_FALLBACK_KEY);
            return;
          }
        } catch (error) {
          useLocalStorageFallback(error);
        }
      }
      localStorage.setItem(ENCRYPTED_NOTES_FALLBACK_KEY, JSON.stringify(record));
    },

    async clearEncryptedNotesRecord() {
      if (backend === "indexedDB") {
        try {
          await clearIndexedDbRecord();
        } catch (error) {
          useLocalStorageFallback(error);
        }
      }
      localStorage.removeItem(ENCRYPTED_NOTES_FALLBACK_KEY);
    },
  };
}

const encryptedNotesStorage = createEncryptedNotesStorage();

function uid() {
  return crypto.randomUUID();
}

function newRevisionId() {
  return uid();
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

function loadSidebarPreference() {
  state.ui.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function persistSidebarPreference() {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.ui.sidebarCollapsed ? "1" : "0");
}

function toggleSidebar() {
  state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
  persistSidebarPreference();
  render();
}

function loadPreviewPreference() {
  previewVisible = localStorage.getItem(PREVIEW_VISIBLE_KEY) !== "0";
}

function persistPreviewPreference() {
  localStorage.setItem(PREVIEW_VISIBLE_KEY, previewVisible ? "1" : "0");
}

function togglePreviewVisibility() {
  previewVisible = !previewVisible;
  persistPreviewPreference();
  render();
}

function isShortcutModifierPressed(event) {
  return Boolean(event.metaKey || event.ctrlKey);
}

function focusSearchInput() {
  if (state.ui.sidebarCollapsed) {
    state.ui.sidebarCollapsed = false;
    persistSidebarPreference();
    render();
  }
  elements.searchInput.focus();
  elements.searchInput.select();
}

function handleKeyboardShortcut(event) {
  if (
    !isUnlocked() ||
    event.defaultPrevented ||
    !isShortcutModifierPressed(event) ||
    elements.settingsView.getAttribute("aria-hidden") !== "true" ||
    isDeleteConfirmOpen()
  ) {
    return;
  }

  const key = String(event.key || "").toLowerCase();

  if (key === "s" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    flushEditorIntoSelectedNote();
    persistNotesSafe();
    render();
    return;
  }

  if (key === "k" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    focusSearchInput();
    return;
  }

  if (key === "n" && event.altKey && !event.shiftKey) {
    event.preventDefault();
    createNote();
  }
}

function normalizeSyncEndpoint(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidSyncMetaRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.deviceId === "string" &&
    record.deviceId.length > 0 &&
    (record.knownServerRevision === null || typeof record.knownServerRevision === "string") &&
    (record.lastSyncedLocalRevision === null || typeof record.lastSyncedLocalRevision === "string") &&
    (record.lastSyncedAt === null || typeof record.lastSyncedAt === "string")
  );
}

function persistSyncMeta() {
  const payload = {
    deviceId: state.sync.deviceId,
    knownServerRevision: state.sync.knownServerRevision,
    lastSyncedLocalRevision: state.sync.lastSyncedLocalRevision,
    lastSyncedAt: state.sync.lastSyncedAt,
  };
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(payload));
}

function loadSyncConfiguration() {
  state.sync.endpoint = normalizeSyncEndpoint(localStorage.getItem(SYNC_ENDPOINT_KEY));

  const rawMeta = localStorage.getItem(SYNC_META_KEY);
  const parsedMeta = safeJsonParse(rawMeta, null);
  if (isValidSyncMetaRecord(parsedMeta)) {
    state.sync.deviceId = parsedMeta.deviceId;
    state.sync.knownServerRevision = parsedMeta.knownServerRevision;
    state.sync.lastSyncedLocalRevision = parsedMeta.lastSyncedLocalRevision || null;
    state.sync.lastSyncedAt = parsedMeta.lastSyncedAt;
  } else {
    state.sync.deviceId = uid();
    state.sync.knownServerRevision = null;
    state.sync.lastSyncedLocalRevision = null;
    state.sync.lastSyncedAt = null;
    persistSyncMeta();
  }
}

function persistSyncEndpoint() {
  localStorage.setItem(SYNC_ENDPOINT_KEY, state.sync.endpoint);
}

function setSyncStatus(message, isError = false) {
  state.sync.statusText = message;
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.toggle("error", isError);
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

function setOrRemoveLocalStorage(key, value) {
  if (value === null) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, value);
}

function normalizeNote(rawNote) {
  return {
    id: String(rawNote.id || uid()),
    title: String(rawNote.title || ""),
    content: String(rawNote.content || ""),
    updatedAt: String(rawNote.updatedAt || nowIso()),
    deleted: Boolean(rawNote.deleted),
  };
}

function normalizeNotesArray(rawNotes) {
  if (!Array.isArray(rawNotes)) {
    return [];
  }
  return rawNotes.filter((n) => n && typeof n === "object").map(normalizeNote);
}

function getActiveNotes() {
  return state.notes.filter((note) => !note.deleted);
}

function isValidEncryptedNotesRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.revisionId === "string" &&
    record.revisionId.length > 0 &&
    record.payload &&
    typeof record.payload === "object" &&
    typeof record.payload.ivB64 === "string" &&
    typeof record.payload.ciphertextB64 === "string"
  );
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

function hasSyncModule() {
  return Boolean(window.JournalSync);
}

function getSyncValidators() {
  return {
    isValidKeyCheckRecord,
    isValidEncryptedNotesRecord,
  };
}

function isValidSyncEncryptedState(payload) {
  if (!hasSyncModule()) {
    return false;
  }
  return window.JournalSync.isValidEncryptedState(payload, getSyncValidators());
}

function isValidSyncEndpoint(endpoint) {
  if (!hasSyncModule()) {
    return false;
  }
  return window.JournalSync.isValidEndpoint(endpoint);
}

function createSyncAdapter(endpoint) {
  if (!hasSyncModule()) {
    throw new Error("Sync module unavailable");
  }

  return window.JournalSync.createRestAdapter({
    endpoint,
    parseJson: (raw) => safeJsonParse(raw, null),
    validators: getSyncValidators(),
  });
}

function setBackupStatus(message, isError = false) {
  elements.backupStatus.textContent = message;
  elements.backupStatus.classList.toggle("error", isError);
}

function setWipeLocalDataStatus(message, isError = false) {
  elements.wipeLocalDataStatus.textContent = message;
  elements.wipeLocalDataStatus.classList.toggle("error", isError);
}

function setChangePassphraseStatus(message, isError = false) {
  elements.changePassphraseStatus.textContent = message;
  elements.changePassphraseStatus.classList.toggle("error", isError);
}

function clearChangePassphraseInputs() {
  elements.currentPassphraseInput.value = "";
  elements.newPassphraseInput.value = "";
  elements.newPassphraseConfirmInput.value = "";
}

function noteUpdatedAtMs(note) {
  const value = Date.parse(String(note && note.updatedAt ? note.updatedAt : ""));
  return Number.isNaN(value) ? 0 : value;
}

function notesContentEqual(left, right) {
  return (
    String(left.title || "") === String(right.title || "") &&
    String(left.content || "") === String(right.content || "") &&
    Boolean(left.deleted) === Boolean(right.deleted)
  );
}

function makeConflictCopyTitle(title, origin) {
  const base = String(title || "").trim() || "Untitled";
  return `${base} (Conflict copy from ${origin})`;
}

function createConflictCopy(note, origin) {
  return normalizeNote({
    ...note,
    id: uid(),
    title: makeConflictCopyTitle(note.title, origin),
    deleted: false,
    updatedAt: nowIso(),
  });
}

function orderedUnionNoteIds(localNotes, serverNotes) {
  const ids = [];
  const seen = new Set();

  for (const note of localNotes) {
    if (!seen.has(note.id)) {
      ids.push(note.id);
      seen.add(note.id);
    }
  }
  for (const note of serverNotes) {
    if (!seen.has(note.id)) {
      ids.push(note.id);
      seen.add(note.id);
    }
  }
  return ids;
}

function mergeNotesKeepBoth(localNotes, serverNotes) {
  const localById = new Map(localNotes.map((note) => [note.id, normalizeNote(note)]));
  const serverById = new Map(serverNotes.map((note) => [note.id, normalizeNote(note)]));
  const merged = [];
  const conflicts = [];

  for (const id of orderedUnionNoteIds(localNotes, serverNotes)) {
    const localNote = localById.get(id) || null;
    const serverNote = serverById.get(id) || null;

    if (localNote && !serverNote) {
      merged.push(localNote);
      continue;
    }
    if (serverNote && !localNote) {
      merged.push(serverNote);
      continue;
    }
    if (!localNote || !serverNote) {
      continue;
    }

    if (notesContentEqual(localNote, serverNote)) {
      merged.push(noteUpdatedAtMs(localNote) >= noteUpdatedAtMs(serverNote) ? localNote : serverNote);
      continue;
    }

    const localIsWinner = noteUpdatedAtMs(localNote) >= noteUpdatedAtMs(serverNote);
    const winner = localIsWinner ? localNote : serverNote;
    const loser = localIsWinner ? serverNote : localNote;
    const loserOrigin = localIsWinner ? "server" : "local";
    const winnerOrigin = localIsWinner ? "local" : "server";

    merged.push(winner);
    let conflictCopyId = null;
    if (!loser.deleted) {
      const copy = createConflictCopy(loser, loserOrigin);
      merged.push(copy);
      conflictCopyId = copy.id;
    }

    conflicts.push({
      noteId: id,
      localUpdatedAt: localNote.updatedAt,
      serverUpdatedAt: serverNote.updatedAt,
      winner: winnerOrigin,
      conflictCopyId,
    });
  }

  merged.sort((a, b) => noteUpdatedAtMs(b) - noteUpdatedAtMs(a));
  return {
    mergedNotes: normalizeNotesArray(merged),
    conflicts,
  };
}

async function decryptEncryptedNotesRecord(record, key) {
  const plaintext = await window.JournalCrypto.decryptString(record.payload, key);
  const parsed = safeJsonParse(plaintext, []);
  if (!Array.isArray(parsed)) {
    throw new Error("Encrypted notes unreadable");
  }
  return normalizeNotesArray(parsed);
}

async function encryptNotesSnapshot(notes, key) {
  const payload = await window.JournalCrypto.encryptString(
    JSON.stringify(normalizeNotesArray(notes)),
    key
  );
  return {
    version: 1,
    revisionId: newRevisionId(),
    updatedAt: nowIso(),
    payload,
  };
}

function setPendingConflict(conflictState) {
  state.sync.pendingConflict = conflictState;
}

function clearPendingConflict() {
  state.sync.pendingConflict = null;
}

function resetSyncStateForFreshSetup() {
  state.sync.endpoint = "";
  state.sync.statusText = "Sync not configured.";
  state.sync.busy = false;
  state.sync.deviceId = uid();
  state.sync.knownServerRevision = null;
  state.sync.lastSyncedLocalRevision = null;
  state.sync.lastSyncedAt = null;
  state.sync.pendingConflict = null;
}

function removeStoredLocalDataKeys() {
  for (const key of LOCAL_DATA_KEYS) {
    localStorage.removeItem(key);
  }
}

async function wipeLocalData() {
  if (state.crypto.wiping || state.crypto.unlocking || state.crypto.rotating || state.sync.busy) {
    return;
  }

  const confirmed = window.confirm(
    "This will permanently erase all local journal data in this browser, including encrypted notes, passphrase setup, sync metadata, and preferences. Continue?"
  );
  if (!confirmed) {
    return;
  }

  state.crypto.wiping = true;
  state.crypto.statusText = "Wiping local data...";
  setWipeLocalDataStatus("Wiping local data...");
  render();

  try {
    clearIdleAutoLockTimer();
    await encryptedNotesStorage.clearEncryptedNotesRecord();
    removeStoredLocalDataKeys();

    state.crypto.key = null;
    state.crypto.keyParams = null;
    state.crypto.keyCheckRecord = null;
    state.crypto.hasPassphrase = false;
    state.crypto.unlocking = false;
    state.crypto.rotating = false;
    state.crypto.autoLockMs = DEFAULT_AUTO_LOCK_MS;
    state.crypto.statusText = "Set passphrase to start";

    elements.passphraseInput.value = "";
    elements.passphraseConfirmInput.value = "";
    clearChangePassphraseInputs();
    setChangePassphraseStatus("No passphrase changes yet.");
    setBackupStatus("No backup action yet.");

    resetSyncStateForFreshSetup();
    persistSyncMeta();
    setSyncStatus(syncSummaryText());

    resetSessionNotes();
    setWipeLocalDataStatus("Local data wiped. Set a new passphrase to start.");
    render();
    openSettings();
  } catch (error) {
    console.error(error);
    state.crypto.statusText = isUnlocked() ? "Unlocked" : "Locked";
    setWipeLocalDataStatus("Failed to wipe local data.", true);
    render();
  } finally {
    state.crypto.wiping = false;
    render();
  }
}

async function resolvePendingConflictWithLocal() {
  const conflict = state.sync.pendingConflict;
  if (!conflict || state.sync.busy) {
    return;
  }
  state.sync.busy = true;
  renderSyncState();
  try {
    localStorage.setItem(KEY_CHECK_KEY, JSON.stringify(conflict.localEncryptedState.keyCheck));
    await encryptedNotesStorage.setEncryptedNotesRecord(conflict.localEncryptedState.encryptedNotes);
    state.crypto.keyCheckRecord = conflict.localEncryptedState.keyCheck;
    state.crypto.hasPassphrase = true;
    state.sync.lastSyncedLocalRevision = conflict.localEncryptedState.encryptedNotes.revisionId;
    clearPendingConflict();
    persistSyncMeta();

    if (isUnlocked()) {
      try {
        await loadNotesForActiveSession();
        state.crypto.statusText = "Unlocked";
      } catch {
        lockCryptoSession("Conflict resolution requires unlock");
        openSettings();
      }
    }

    setSyncStatus("Conflict resolved with local version. Sync again to push changes.");
    render();
  } catch (error) {
    console.error(error);
    setSyncStatus("Failed to apply local conflict resolution.", true);
  } finally {
    state.sync.busy = false;
    renderSyncState();
  }
}

async function resolvePendingConflictWithServer() {
  const conflict = state.sync.pendingConflict;
  if (!conflict || state.sync.busy) {
    return;
  }
  state.sync.busy = true;
  renderSyncState();
  try {
    await applySyncedServerState(conflict.serverEncryptedState);
    state.sync.lastSyncedLocalRevision = conflict.serverEncryptedState.encryptedNotes.revisionId;
    clearPendingConflict();
    persistSyncMeta();
    setSyncStatus("Conflict resolved with server version.");
    render();
  } catch (error) {
    console.error(error);
    setSyncStatus("Failed to apply server conflict resolution.", true);
  } finally {
    state.sync.busy = false;
    renderSyncState();
  }
}

function syncSummaryText() {
  if (state.sync.pendingConflict) {
    return "Pending conflict resolution.";
  }
  if (!hasSyncModule()) {
    return "Sync module unavailable.";
  }
  if (!state.sync.endpoint) {
    return "Sync not configured.";
  }
  if (!state.crypto.hasPassphrase) {
    return "Set a passphrase to enable sync.";
  }
  if (state.sync.lastSyncedAt) {
    return `Last synced ${formatDate(state.sync.lastSyncedAt)}.`;
  }
  return "Ready to sync.";
}

function buildSyncRequestPayload(localEncryptedState) {
  if (!hasSyncModule()) {
    throw new Error("Sync module unavailable");
  }

  return window.JournalSync.buildSyncRequest({
    deviceId: state.sync.deviceId,
    knownServerRevision: state.sync.knownServerRevision,
    localRevision: localEncryptedState.encryptedNotes.revisionId,
    sentAt: nowIso(),
    encryptedState: localEncryptedState,
  });
}

async function buildLocalSyncState() {
  const encryptedNotesRecord = await encryptedNotesStorage.getEncryptedNotesRecord();
  if (!isValidKeyCheckRecord(state.crypto.keyCheckRecord) || !isValidEncryptedNotesRecord(encryptedNotesRecord)) {
    return null;
  }

  return {
    keyCheck: state.crypto.keyCheckRecord,
    encryptedNotes: encryptedNotesRecord,
  };
}

async function applySyncedServerState(serverEncryptedState) {
  if (!isValidSyncEncryptedState(serverEncryptedState)) {
    return false;
  }

  localStorage.setItem(KEY_CHECK_KEY, JSON.stringify(serverEncryptedState.keyCheck));
  await encryptedNotesStorage.setEncryptedNotesRecord(serverEncryptedState.encryptedNotes);
  state.crypto.keyCheckRecord = serverEncryptedState.keyCheck;
  state.crypto.hasPassphrase = true;

  if (!isUnlocked()) {
    return true;
  }

  try {
    await loadNotesForActiveSession();
    state.crypto.statusText = "Unlocked";
    render();
    return true;
  } catch {
    lockCryptoSession("Synced data requires unlock");
    openSettings();
    return true;
  }
}

async function syncNow() {
  if (state.sync.busy) {
    return;
  }
  if (state.sync.pendingConflict) {
    setSyncStatus("Resolve pending conflict before syncing again.", true);
    renderSyncState();
    return;
  }
  if (!hasSyncModule()) {
    setSyncStatus("Sync module unavailable.", true);
    renderSyncState();
    return;
  }

  const endpoint = normalizeSyncEndpoint(state.sync.endpoint);
  if (!endpoint || !isValidSyncEndpoint(endpoint)) {
    setSyncStatus("Enter a valid sync endpoint URL.", true);
    renderSyncState();
    return;
  }
  if (!state.crypto.hasPassphrase) {
    setSyncStatus("Set a passphrase before syncing.", true);
    renderSyncState();
    return;
  }

  state.sync.busy = true;
  setSyncStatus("Syncing...");
  renderSyncState();

  try {
    if (isUnlocked()) {
      flushEditorIntoSelectedNote();
      await persistNotes();
    }

    const localSyncState = await buildLocalSyncState();
    if (!localSyncState) {
      throw new Error("No encrypted notes are available to sync.");
    }

    const adapter = createSyncAdapter(endpoint);
    const response = await adapter.sync(buildSyncRequestPayload(localSyncState));
    const remoteState = response.serverEncryptedState || null;
    const hasRemoteUpdate =
      remoteState &&
      remoteState.encryptedNotes.revisionId !== localSyncState.encryptedNotes.revisionId;
    const localRevision = localSyncState.encryptedNotes.revisionId;
    const remoteRevision = remoteState ? remoteState.encryptedNotes.revisionId : null;
    const localChangedSinceLastSync =
      Boolean(state.sync.lastSyncedLocalRevision) &&
      localRevision !== state.sync.lastSyncedLocalRevision;
    const remoteChangedSinceLastSync =
      Boolean(state.sync.lastSyncedLocalRevision) &&
      Boolean(remoteRevision) &&
      remoteRevision !== state.sync.lastSyncedLocalRevision;
    const hasConflictSignal = Boolean(response.conflict);
    const hasDivergenceConflict =
      Boolean(hasRemoteUpdate) && localChangedSinceLastSync && remoteChangedSinceLastSync;

    if (hasConflictSignal || hasDivergenceConflict) {
      if (!isUnlocked() || !state.crypto.key) {
        throw new Error("Unlock to resolve sync conflicts.");
      }
      if (!remoteState) {
        throw new Error("Conflict detected without server state.");
      }

      const localNotes = await decryptEncryptedNotesRecord(localSyncState.encryptedNotes, state.crypto.key);
      const serverNotes = await decryptEncryptedNotesRecord(remoteState.encryptedNotes, state.crypto.key);
      const mergeResult = mergeNotesKeepBoth(localNotes, serverNotes);
      const mergedEncryptedNotes = await encryptNotesSnapshot(mergeResult.mergedNotes, state.crypto.key);
      await encryptedNotesStorage.setEncryptedNotesRecord(mergedEncryptedNotes);
      await loadNotesForActiveSession();

      state.sync.lastSyncedLocalRevision = mergedEncryptedNotes.revisionId;
      setPendingConflict({
        detectedAt: nowIso(),
        localEncryptedState: localSyncState,
        serverEncryptedState: remoteState,
        summary:
          mergeResult.conflicts.length > 0
            ? `Conflict detected on ${mergeResult.conflicts.length} note(s). Keep-both merge applied locally.`
            : "Conflict metadata detected. Keep-both merge applied locally.",
      });
      setSyncStatus("Conflict detected. Review merge/replace options.", true);
    } else if (hasRemoteUpdate) {
      await applySyncedServerState(remoteState);
      state.sync.lastSyncedLocalRevision = remoteRevision;
    } else {
      state.sync.lastSyncedLocalRevision = localRevision;
    }

    state.sync.knownServerRevision = response.serverRevision || state.sync.knownServerRevision;
    state.sync.lastSyncedAt = nowIso();
    persistSyncMeta();
    if (!state.sync.pendingConflict) {
      setSyncStatus(`Sync completed ${formatDate(state.sync.lastSyncedAt)}.`);
    }
  } catch (error) {
    console.error(error);
    const message = error && typeof error.message === "string"
      ? error.message
      : "Sync failed.";
    setSyncStatus(message, true);
  } finally {
    state.sync.busy = false;
    renderSyncState();
  }
}

async function persistNotes() {
  if (!isUnlocked() || !state.crypto.key || !window.JournalCrypto) {
    return;
  }
  const plaintext = JSON.stringify(state.notes);
  const payload = await window.JournalCrypto.encryptString(plaintext, state.crypto.key);
  const record = {
    version: 1,
    revisionId: newRevisionId(),
    updatedAt: nowIso(),
    payload,
  };
  await encryptedNotesStorage.setEncryptedNotesRecord(record);
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

  const encryptedRecord = await encryptedNotesStorage.getEncryptedNotesRecord();
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
    state.notes = [];
  }

  const activeNotes = getActiveNotes();
  if (activeNotes.length === 0) {
    const initialNote = normalizeNote({ title: "Untitled", content: "", deleted: false });
    state.notes = [initialNote];
    state.selectedId = initialNote.id;
    await persistNotes();
  } else if (
    !state.selectedId ||
    !activeNotes.some((note) => note.id === state.selectedId)
  ) {
    state.selectedId = activeNotes[0].id;
  }
}

function createNote() {
  const note = normalizeNote({ title: "Untitled", content: "", deleted: false });
  state.notes.unshift(note);
  state.selectedId = note.id;
  persistNotesSafe();
  render();
}

function getSelectedNote() {
  return state.notes.find((note) => note.id === state.selectedId && !note.deleted) || null;
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
  const activeNotes = getActiveNotes();
  if (activeNotes.length <= 1) {
    return;
  }
  const noteToDelete = getSelectedNote();
  if (!noteToDelete) {
    return;
  }

  noteToDelete.deleted = true;
  noteToDelete.updatedAt = nowIso();
  const nextNote = getActiveNotes().find((note) => note.id !== noteToDelete.id) || null;
  state.selectedId = nextNote ? nextNote.id : null;
  persistNotesSafe();
  render();
}

function isDeleteConfirmOpen() {
  return elements.deleteConfirmView.getAttribute("aria-hidden") === "false";
}

function openDeleteConfirmModal() {
  if (!isUnlocked() || getActiveNotes().length <= 1) {
    return;
  }
  const noteToDelete = getSelectedNote();
  if (!noteToDelete) {
    return;
  }
  const noteTitle = noteToDelete.title.trim() || "Untitled";
  elements.deleteConfirmNoteTitle.textContent = `Note: ${noteTitle}`;
  elements.deleteConfirmView.classList.remove("hidden");
  elements.deleteConfirmView.setAttribute("aria-hidden", "false");
  elements.deleteConfirmCancelBtn.focus();
}

function closeDeleteConfirmModal({ restoreFocus = true } = {}) {
  if (!isDeleteConfirmOpen()) {
    return;
  }
  elements.deleteConfirmView.classList.add("hidden");
  elements.deleteConfirmView.setAttribute("aria-hidden", "true");
  if (restoreFocus) {
    elements.deleteNoteBtn.focus();
  }
}

function confirmDeleteSelectedNote() {
  deleteSelectedNote();
  closeDeleteConfirmModal({ restoreFocus: false });
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
  const activeNotes = getActiveNotes();
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = query
    ? activeNotes.filter((note) => {
        const haystack = `${note.title}\n${note.content}`.toLowerCase();
        return haystack.includes(query);
      })
    : activeNotes;

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
  const canRotate = state.crypto.hasPassphrase;
  const controlsBusy = state.crypto.unlocking || state.crypto.rotating || state.crypto.wiping;

  elements.cryptoStatus.textContent = state.crypto.statusText;
  elements.cryptoStatus.classList.toggle("unlocked", isUnlocked());
  elements.cryptoStatus.classList.toggle("locked", !isUnlocked());
  elements.setupConfirmWrap.classList.toggle("hidden", !needsSetup);
  elements.changePassphraseWrap.classList.toggle("hidden", !canRotate);
  elements.passphraseInput.placeholder = needsSetup
    ? "Create a passphrase (min 8 chars)"
    : "Enter passphrase to unlock";
  elements.unlockBtn.textContent = needsSetup ? "Set Passphrase" : "Unlock";
  elements.unlockBtn.disabled = controlsBusy || isUnlocked();
  elements.lockBtn.disabled = !isUnlocked() || controlsBusy;
  elements.closeSettingsBtn.disabled = needsSetup;
  elements.exportBackupBtn.disabled = controlsBusy || !state.crypto.hasPassphrase;
  elements.importBackupBtn.disabled = controlsBusy;
  elements.changePassphraseBtn.disabled = controlsBusy || !isUnlocked();
  elements.currentPassphraseInput.disabled = controlsBusy || !isUnlocked();
  elements.newPassphraseInput.disabled = controlsBusy || !isUnlocked();
  elements.newPassphraseConfirmInput.disabled = controlsBusy || !isUnlocked();
  elements.autoLockSelect.value = String(state.crypto.autoLockMs);
  elements.wipeLocalDataBtn.disabled = controlsBusy;
}

function renderSyncState() {
  const endpoint = normalizeSyncEndpoint(state.sync.endpoint);
  const endpointValid = endpoint.length > 0 && isValidSyncEndpoint(endpoint);
  const hasPendingConflict = Boolean(state.sync.pendingConflict);
  const canSync =
    !state.sync.busy &&
    !hasPendingConflict &&
    state.crypto.hasPassphrase &&
    endpointValid;

  elements.syncEndpointInput.value = endpoint;
  elements.syncEndpointInput.disabled = state.sync.busy;
  elements.syncNowBtn.disabled = !canSync;
  elements.syncConflictWrap.classList.toggle("hidden", !hasPendingConflict);
  elements.syncUseLocalBtn.disabled = state.sync.busy || !hasPendingConflict;
  elements.syncUseServerBtn.disabled = state.sync.busy || !hasPendingConflict;

  if (hasPendingConflict) {
    elements.syncConflictText.textContent = state.sync.pendingConflict.summary;
  }

  if (!state.sync.statusText) {
    setSyncStatus(syncSummaryText());
  } else if (!state.sync.busy && !elements.syncStatus.classList.contains("error")) {
    setSyncStatus(syncSummaryText());
  }
}

function renderSidebarState() {
  const collapsed = state.ui.sidebarCollapsed;
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  elements.toggleSidebarBtn.textContent = collapsed ? "Show Sidebar" : "Hide Sidebar";
  elements.toggleSidebarBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function renderPreviewState() {
  document.body.classList.toggle("preview-hidden", !previewVisible);
  togglePreviewBtn.textContent = previewVisible ? "Hide Preview" : "Show Preview";
  togglePreviewBtn.setAttribute("aria-pressed", previewVisible ? "false" : "true");
}

function render() {
  const locked = !isUnlocked();
  const needsSetup = !state.crypto.hasPassphrase;

  renderSidebarState();
  renderPreviewState();
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
  renderSyncState();
  elements.deleteNoteBtn.disabled = locked || getActiveNotes().length <= 1 || isDeleteConfirmOpen();
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
  closeDeleteConfirmModal({ restoreFocus: false });
  state.crypto.key = null;
  state.crypto.keyParams = null;
  state.crypto.unlocking = false;
  state.crypto.rotating = false;
  state.crypto.wiping = false;
  state.crypto.statusText = reasonText;
  elements.passphraseInput.value = "";
  elements.passphraseConfirmInput.value = "";
  clearChangePassphraseInputs();
  clearIdleAutoLockTimer();
  resetSessionNotes();
  render();
}

async function deriveAndVerifyPassphrase(passphrase, keyCheckRecord) {
  if (!isValidKeyCheckRecord(keyCheckRecord)) {
    throw new Error("Passphrase record missing");
  }

  const derived = await window.JournalCrypto.deriveSessionKey(passphrase, {
    saltB64: keyCheckRecord.saltB64,
    iterations: keyCheckRecord.iterations,
  });
  const checkPlaintext = await window.JournalCrypto.decryptString(keyCheckRecord.check, derived.key);
  if (checkPlaintext !== KEY_CHECK_SENTINEL) {
    throw new Error("Wrong passphrase");
  }
  return derived;
}

async function unlockCryptoSession() {
  if (state.crypto.unlocking || state.crypto.rotating || isUnlocked()) {
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

    const unlockResult = await deriveAndVerifyPassphrase(passphrase, state.crypto.keyCheckRecord);

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

async function rotatePassphrase() {
  if (state.crypto.unlocking || state.crypto.rotating) {
    return;
  }
  if (!state.crypto.hasPassphrase || !isUnlocked()) {
    setChangePassphraseStatus("Unlock before changing passphrase.", true);
    return;
  }
  if (!window.JournalCrypto) {
    setChangePassphraseStatus("Crypto module unavailable.", true);
    return;
  }

  const currentPassphrase = elements.currentPassphraseInput.value;
  const newPassphrase = elements.newPassphraseInput.value;
  const confirmNewPassphrase = elements.newPassphraseConfirmInput.value;

  if (typeof currentPassphrase !== "string" || currentPassphrase.length < 8) {
    setChangePassphraseStatus("Current passphrase is too short.", true);
    return;
  }
  if (typeof newPassphrase !== "string" || newPassphrase.length < 8) {
    setChangePassphraseStatus("New passphrase must be at least 8 characters.", true);
    return;
  }
  if (newPassphrase !== confirmNewPassphrase) {
    setChangePassphraseStatus("New passphrases do not match.", true);
    return;
  }
  if (newPassphrase === currentPassphrase) {
    setChangePassphraseStatus("New passphrase must differ from current.", true);
    return;
  }

  state.crypto.rotating = true;
  state.crypto.statusText = "Rotating key...";
  renderCryptoState();

  try {
    flushEditorIntoSelectedNote();
    const notesSnapshot = normalizeNotesArray(state.notes);
    await deriveAndVerifyPassphrase(currentPassphrase, state.crypto.keyCheckRecord);

    const nextKeyResult = await window.JournalCrypto.deriveSessionKey(newPassphrase);
    const nextKeyCheck = {
      version: 1,
      saltB64: nextKeyResult.params.saltB64,
      iterations: nextKeyResult.params.iterations,
      check: await window.JournalCrypto.encryptString(KEY_CHECK_SENTINEL, nextKeyResult.key),
    };
    const nextEncryptedNotes = {
      version: 1,
      revisionId: newRevisionId(),
      updatedAt: nowIso(),
      payload: await window.JournalCrypto.encryptString(
        JSON.stringify(notesSnapshot),
        nextKeyResult.key
      ),
    };

    const previousKeyCheckRaw = localStorage.getItem(KEY_CHECK_KEY);
    const previousEncryptedNotesRecord = await encryptedNotesStorage.getEncryptedNotesRecord();

    try {
      localStorage.setItem(KEY_CHECK_KEY, JSON.stringify(nextKeyCheck));
      await encryptedNotesStorage.setEncryptedNotesRecord(nextEncryptedNotes);
    } catch (persistError) {
      setOrRemoveLocalStorage(KEY_CHECK_KEY, previousKeyCheckRaw);
      if (previousEncryptedNotesRecord) {
        await encryptedNotesStorage.setEncryptedNotesRecord(previousEncryptedNotesRecord);
      } else {
        await encryptedNotesStorage.clearEncryptedNotesRecord();
      }
      throw persistError;
    }

    state.crypto.keyCheckRecord = nextKeyCheck;
    state.crypto.key = nextKeyResult.key;
    state.crypto.keyParams = nextKeyResult.params;
    state.crypto.statusText = "Unlocked";
    clearChangePassphraseInputs();
    scheduleIdleAutoLock();
    setChangePassphraseStatus("Passphrase changed and data re-encrypted.");
    setBackupStatus("Backup recommended after passphrase rotation.");
  } catch (error) {
    console.error(error);
    if (error && error.message === "Wrong passphrase") {
      setChangePassphraseStatus("Current passphrase is incorrect.", true);
    } else if (error && error.message === "Passphrase record missing") {
      setChangePassphraseStatus("Passphrase setup record missing.", true);
    } else {
      setChangePassphraseStatus("Passphrase rotation failed.", true);
    }
    state.crypto.statusText = "Unlocked";
  } finally {
    state.crypto.rotating = false;
    renderCryptoState();
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
    const encryptedNotesRecord = await encryptedNotesStorage.getEncryptedNotesRecord();
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
    await encryptedNotesStorage.setEncryptedNotesRecord(parsed.encryptedNotes);

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
  elements.toggleSidebarBtn.addEventListener("click", () => {
    toggleSidebar();
  });

  togglePreviewBtn.addEventListener("click", () => {
    togglePreviewVisibility();
  });

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
    openDeleteConfirmModal();
  });

  elements.deleteConfirmCancelBtn.addEventListener("click", () => {
    closeDeleteConfirmModal();
  });

  elements.deleteConfirmConfirmBtn.addEventListener("click", () => {
    confirmDeleteSelectedNote();
  });

  elements.deleteConfirmBackdrop.addEventListener("click", () => {
    closeDeleteConfirmModal();
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

  elements.changePassphraseBtn.addEventListener("click", () => {
    rotatePassphrase();
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

  elements.wipeLocalDataBtn.addEventListener("click", () => {
    wipeLocalData();
  });

  elements.syncEndpointInput.addEventListener("input", (event) => {
    state.sync.endpoint = normalizeSyncEndpoint(event.target.value);
    persistSyncEndpoint();
    setSyncStatus(syncSummaryText());
    renderSyncState();
  });

  elements.syncEndpointInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      syncNow();
    }
  });

  elements.syncNowBtn.addEventListener("click", () => {
    syncNow();
  });

  elements.syncUseLocalBtn.addEventListener("click", () => {
    resolvePendingConflictWithLocal();
  });

  elements.syncUseServerBtn.addEventListener("click", () => {
    resolvePendingConflictWithServer();
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

  elements.currentPassphraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      rotatePassphrase();
    }
  });

  elements.newPassphraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      rotatePassphrase();
    }
  });

  elements.newPassphraseConfirmInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      rotatePassphrase();
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
    if (event.key === "Escape" && isDeleteConfirmOpen()) {
      closeDeleteConfirmModal();
      return;
    }
    if (event.key === "Escape" && !elements.settingsView.classList.contains("hidden")) {
      closeSettings();
      return;
    }
    handleKeyboardShortcut(event);
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
  loadSidebarPreference();
  loadPreviewPreference();
  loadKeyCheckRecord();
  loadSyncConfiguration();
  setSyncStatus(syncSummaryText());
  wireEvents();
  render();
  if (!state.crypto.hasPassphrase) {
    openSettings();
  }
}

init();
