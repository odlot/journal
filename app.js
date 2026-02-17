"use strict";

const STORAGE_KEY = "journal.notes.v1";
const AUTOSAVE_DELAY_MS = 250;

const elements = {
  newNoteBtn: document.getElementById("new-note-btn"),
  deleteNoteBtn: document.getElementById("delete-note-btn"),
  searchInput: document.getElementById("search-input"),
  noteList: document.getElementById("note-list"),
  noteTitleInput: document.getElementById("note-title-input"),
  noteContentInput: document.getElementById("note-content-input"),
  previewOutput: document.getElementById("preview-output"),
};

const state = {
  notes: [],
  selectedId: null,
  searchQuery: "",
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

function loadNotes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  if (Array.isArray(parsed) && parsed.length > 0) {
    state.notes = parsed
      .filter((n) => n && typeof n === "object")
      .map((n) => ({
        id: String(n.id || uid()),
        title: String(n.title || ""),
        content: String(n.content || ""),
        updatedAt: String(n.updatedAt || nowIso()),
      }));
    state.selectedId = state.notes[0].id;
    return;
  }
  createNote();
}

function persistNotes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
}

function createNote() {
  const note = {
    id: uid(),
    title: "Untitled",
    content: "",
    updatedAt: nowIso(),
  };
  state.notes.unshift(note);
  state.selectedId = note.id;
  persistNotes();
  render();
}

function getSelectedNote() {
  return state.notes.find((note) => note.id === state.selectedId) || null;
}

function deleteSelectedNote() {
  if (state.notes.length <= 1) {
    return;
  }
  state.notes = state.notes.filter((note) => note.id !== state.selectedId);
  state.selectedId = state.notes[0].id;
  persistNotes();
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

function render() {
  renderNoteList();
  renderEditor();
  elements.deleteNoteBtn.disabled = state.notes.length <= 1;
}

const saveEditorChanges = debounce(() => {
  const note = getSelectedNote();
  if (!note) {
    return;
  }
  note.title = elements.noteTitleInput.value.trim() || "Untitled";
  note.content = elements.noteContentInput.value;
  note.updatedAt = nowIso();
  persistNotes();
  render();
}, AUTOSAVE_DELAY_MS);

function wireEvents() {
  elements.newNoteBtn.addEventListener("click", () => {
    createNote();
  });

  elements.deleteNoteBtn.addEventListener("click", () => {
    deleteSelectedNote();
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderNoteList();
  });

  elements.noteList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-note-id]");
    if (!button) {
      return;
    }
    state.selectedId = button.dataset.noteId;
    render();
  });

  elements.noteTitleInput.addEventListener("input", () => {
    saveEditorChanges();
  });

  elements.noteContentInput.addEventListener("input", () => {
    const note = getSelectedNote();
    if (!note) {
      return;
    }
    elements.previewOutput.innerHTML = renderMarkdown(elements.noteContentInput.value);
    saveEditorChanges();
  });
}

function init() {
  loadNotes();
  wireEvents();
  render();
}

init();
