/* eslint-disable no-undef */
const MODULE_ID = "ninja-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

/* ──────────────────────────────────────── */
/* Settings                                  */
/* ──────────────────────────────────────── */
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoOpenGMPanel", {
    name: "Auto-open GM Panel",
    hint: "Open the Ninja Notes panel automatically when the world loads (GM only).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "playSound", {
    name: "Play Sound on Note",
    hint: "Play a local chime when a Ninja Note arrives.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "maxNotesPerWindow", {
    name: "Max Notes per Minute",
    hint: "How many notes a player can send per minute.",
    scope: "world",
    config: true,
    type: Number,
    default: 3,
    range: { min: 1, max: 10, step: 1 }
  });

  game.settings.register(MODULE_ID, "persistHistory", {
    name: "Remember Notes",
    hint: "Keep notes visible after world reload.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "historyLimit", {
    name: "Max Stored Notes",
    hint: "Maximum notes to remember (older notes are deleted).",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    range: { min: 10, max: 500, step: 10 }
  });

  game.settings.register(MODULE_ID, "history", {
    scope: "world",
    config: false,
    type: Object,
    default: []
  });

  // Initialize global reference
  game.ninjaNotes = { gmPanel: null };
});

/* ──────────────────────────────────────── */
/* Utilities                                 */
/* ──────────────────────────────────────── */
class ThrottleManager {
  constructor() {
    this.trackers = new Map();
  }

  isThrottled(userId, limit = 3, windowMs = 60000) {
    const now = Date.now();
    const history = this.trackers.get(userId) || [];
    const recent = history.filter(time => now - time < windowMs);

    if (recent.length >= limit) return true;

    recent.push(now);
    this.trackers.set(userId, recent);
    return false;
  }

  getRemainingTime(userId, windowMs = 60000) {
    const history = this.trackers.get(userId) || [];
    if (history.length === 0) return 0;
    const oldest = Math.min(...history);
    const remaining = windowMs - (Date.now() - oldest);
    return Math.max(0, remaining);
  }
}

const gmThrottle = new ThrottleManager();
const clientThrottle = new ThrottleManager();

function getThrottleConfig() {
  const limit = Number(game.settings.get(MODULE_ID, "maxNotesPerWindow")) || 3;
  return { limit, windowMs: 60000 };
}

async function loadHistory() {
  if (!game.settings.get(MODULE_ID, "persistHistory")) return [];
  try {
    const history = game.settings.get(MODULE_ID, "history");
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to load history:`, error);
    return [];
  }
}

async function saveHistory(notes) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "persistHistory")) return;
  try {
    const limit = Number(game.settings.get(MODULE_ID, "historyLimit")) || 100;
    const trimmed = notes.slice(-limit);
    await game.settings.set(MODULE_ID, "history", trimmed);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to save history:`, error);
  }
}

function isGMOnline() {
  return game.users?.some(u => u.isGM && u.active) || false;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function flashWindow(app) {
  // AppV2: .element is a native HTMLElement (not jQuery)
  const el = app?.element;
  if (!el) return;

  try {
    app.bringToFront();
  } catch {
    // Ignore positioning errors
  }

  el.classList.remove("nn-flash");
  void el.offsetWidth; // Force reflow
  el.classList.add("nn-flash");
  setTimeout(() => el.classList.remove("nn-flash"), 2000);
}

function playNotificationSound() {
  if (!game.settings.get(MODULE_ID, "playSound")) return;
  try {
    const audio = new Audio(`modules/${MODULE_ID}/sounds/note.mp3`);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch {
    // Ignore audio errors
  }
}

/* ──────────────────────────────────────── */
/* Escape HTML (for safe rendering)          */
/* ──────────────────────────────────────── */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ──────────────────────────────────────── */
/* GM Panel — ApplicationV2                  */
/* ──────────────────────────────────────── */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class NinjaNotesGMPanel extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "ninja-notes-gm-panel",
    classes: ["ninja-notes-app"],
    position: { width: 400, height: 500 },
    window: {
      title: "Ninja Notes",
      resizable: true,
      controls: [
        {
          icon: "fas fa-trash",
          label: "Clear All",
          action: "clearNotes"
        }
      ]
    },
    actions: {
      clearNotes: NinjaNotesGMPanel._onClearNotes
    }
  };

  /** @override */
  static PARTS = {
    panel: {
      template: `modules/${MODULE_ID}/templates/gm-panel.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this.notes = [];
  }

  /** @override */
  async _prepareContext(_options) {
    return {
      notes: this.notes.map(note => ({
        ...note,
        timestamp: formatTimestamp(note.ts),
        escapedMessage: escapeHTML(note.message)
      }))
    };
  }

  async setNotes(notes) {
    this.notes = Array.isArray(notes) ? notes : [];
    this.render({ force: true });
  }

  async addNote(note) {
    this.notes.push(note);
    await saveHistory(this.notes);
    this.render({ force: true });
  }

  async clearNotes() {
    this.notes = [];
    await saveHistory(this.notes);
    this.render({ force: true });
  }

  /**
   * Header button action: Clear all notes
   */
  static async _onClearNotes() {
    await this.clearNotes();
  }
}

/* ──────────────────────────────────────── */
/* Socket Handlers                           */
/* ──────────────────────────────────────── */
function setupSocketHandlers() {
  game.socket.on(SOCKET_NAME, async (data) => {
    if (!data?.type) return;

    switch (data.type) {
      case "newNote":
        await handleIncomingNote(data.payload);
        break;
      case "throttled":
        handleThrottleNotification(data.payload);
        break;
    }
  });
}

async function handleIncomingNote(payload) {
  if (!game.user.isGM || !payload?.senderId) return;

  const { limit, windowMs } = getThrottleConfig();

  if (gmThrottle.isThrottled(payload.senderId, limit, windowMs)) {
    const retryMs = gmThrottle.getRemainingTime(payload.senderId, windowMs);
    game.socket.emit(SOCKET_NAME, {
      type: "throttled",
      payload: { targetId: payload.senderId, retryMs }
    });
    return;
  }

  const sender = game.users.get(payload.senderId);
  if (!sender) return;

  const note = {
    ts: Date.now(),
    senderId: payload.senderId,
    senderName: sender.name,
    senderColor: sender.color?.toString?.() ?? sender.color ?? "#000000",
    message: String(payload.message || "").trim()
  };

  if (!note.message) return;

  const panel = game.ninjaNotes.gmPanel;
  if (panel) {
    await panel.addNote(note);
    ui.notifications.info(`Ninja Note from ${sender.name}`);
    playNotificationSound();
    panel.render({ force: true });
    flashWindow(panel);
  }
}

function handleThrottleNotification(payload) {
  const { targetId, retryMs } = payload || {};
  if (targetId !== game.user.id) return;
  const seconds = Math.ceil(Number(retryMs || 60000) / 1000);
  ui.notifications.warn(`Sending too fast! Wait ${seconds} seconds.`);
}

/* ──────────────────────────────────────── */
/* Player Interface — DialogV2               */
/* ──────────────────────────────────────── */
async function openNoteDialog(prefill = "") {
  if (!isGMOnline()) {
    ui.notifications.warn("No GM is online. Your note will only be seen when a GM logs in.");
  }

  const gmStatus = isGMOnline() ? "Yes" : "No";
  const escaped = foundry.utils.escapeHTML?.(prefill) ?? escapeHTML(prefill);

  const content = `
    <div class="form-group">
      <label>Secret message to GM:</label>
      <textarea name="ninja-note-text" rows="6" style="width:100%; resize: vertical; font-family: inherit;">${escaped}</textarea>
    </div>
    <p style="font-size: 0.9em; opacity: 0.7; margin-top: 8px;">
      <i class="fas fa-info-circle"></i> GM Online: ${gmStatus}
    </p>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Send Ninja Note" },
    content,
    ok: {
      icon: "fas fa-paper-plane",
      label: "Send",
      callback: (event, button, dialog) => {
        const textarea = dialog.querySelector('textarea[name="ninja-note-text"]');
        return textarea?.value?.trim() || "";
      }
    },
    rejectClose: false
  });

  if (result) sendNinjaNote(result);
}

function sendNinjaNote(message) {
  const { limit, windowMs } = getThrottleConfig();

  if (clientThrottle.isThrottled(game.user.id, limit, windowMs)) {
    const remaining = Math.ceil(clientThrottle.getRemainingTime(game.user.id, windowMs) / 1000);
    ui.notifications.warn(`Please wait ${remaining} seconds before sending another note.`);
    return;
  }

  game.socket.emit(SOCKET_NAME, {
    type: "newNote",
    payload: {
      senderId: game.user.id,
      message: String(message).trim()
    }
  });

  ui.notifications.info("Ninja Note sent!");
}

/* ──────────────────────────────────────── */
/* Auto-Create Macros                        */
/* ──────────────────────────────────────── */
async function createGMMacro() {
  const macroName = "\u{1F977} Ninja Notes";
  const existing = game.macros.find(m =>
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (existing) return;

  try {
    await Macro.create({
      name: macroName,
      type: "script",
      img: "icons/sundries/scrolls/scroll-bound-red.webp",
      command: `const mod = game.modules.get("ninja-notes");
if (mod?.api?.open) mod.api.open();
else ui.notifications.error("Ninja Notes module not available.");`,
      flags: { [MODULE_ID]: { autoCreated: true } }
    });
    ui.notifications.info("Ninja Notes GM macro created!");
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to create GM macro:`, error);
  }
}

async function createPlayerMacro() {
  const macroName = "\u{1F4DD} Send Ninja Note";
  const existing = game.macros.find(m =>
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (existing) return;

  try {
    await Macro.create({
      name: macroName,
      type: "script",
      img: "icons/sundries/documents/document-sealed-red.webp",
      command: `const mod = game.modules.get("ninja-notes");
if (mod?.api?.sendNote) mod.api.sendNote();
else ui.notifications.error("Ninja Notes module not available.");`,
      flags: { [MODULE_ID]: { autoCreated: true } }
    });
    ui.notifications.info("Ninja Notes player macro created!");
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to create player macro:`, error);
  }
}

/* ──────────────────────────────────────── */
/* Chat Commands                             */
/* ──────────────────────────────────────── */
function setupChatCommands() {
  Hooks.on("chatMessage", (_log, content) => {
    const text = String(content || "").trim();

    // /nn or /ninja command
    const noteMatch = text.match(/^\/(nn|ninja)\s+(.+)$/i);
    if (noteMatch) {
      const message = noteMatch[2].trim();
      if (message) sendNinjaNote(message);
      return false;
    }

    // /nnhelp command
    if (text.match(/^\/nnhelp$/i)) {
      const { limit } = getThrottleConfig();
      const gmOnline = isGMOnline();

      const helpText = `
        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px;">
          <h4><i class="fas fa-scroll"></i> Ninja Notes Help</h4>
          <p><strong>Commands:</strong></p>
          <ul>
            <li><code>/nn your message</code> — Send a secret note to the GM</li>
            <li><code>/nnhelp</code> — Show this help</li>
          </ul>
          <p><strong>Limits:</strong> ${limit} notes per minute</p>
          <p><strong>GM Status:</strong> ${gmOnline ? "\u{1F7E2} Online" : "\u{1F534} Offline"}</p>
        </div>
      `;

      ChatMessage.create({
        content: helpText,
        whisper: [game.user.id]
      });
      return false;
    }

    return true;
  });
}

/* ──────────────────────────────────────── */
/* Context Menu                              */
/* ──────────────────────────────────────── */
function setupContextMenu() {
  Hooks.on("getUserContextOptions", (_playerList, options) => {
    if (game.user.isGM) return;

    options.push({
      name: "Send Ninja Note",
      icon: '<i class="fas fa-scroll"></i>',
      condition: (li) => {
        const userId = li?.dataset?.userId ?? li?.data?.("userId");
        return game.users.get(userId)?.isGM === true;
      },
      callback: () => openNoteDialog()
    });
  });
}

/* ──────────────────────────────────────── */
/* Module API                                */
/* ──────────────────────────────────────── */
function setupModuleAPI() {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  module.api = {
    open: () => {
      if (!game.user.isGM) {
        ui.notifications.warn("Only GMs can open the Ninja Notes panel.");
        return;
      }
      const panel = game.ninjaNotes.gmPanel;
      if (panel) {
        panel.render({ force: true });
        flashWindow(panel);
      }
    },
    sendNote: () => {
      if (game.user.isGM) {
        ui.notifications.info("GMs cannot send notes to themselves!");
        return;
      }
      openNoteDialog();
    }
  };
}

/* ──────────────────────────────────────── */
/* Ready Hook — Initialize Everything        */
/* ──────────────────────────────────────── */
Hooks.on("ready", async () => {
  setupModuleAPI();
  setupSocketHandlers();
  setupChatCommands();
  setupContextMenu();

  if (game.user.isGM) {
    if (!game.ninjaNotes.gmPanel) {
      game.ninjaNotes.gmPanel = new NinjaNotesGMPanel();
    }

    const history = await loadHistory();
    if (history.length > 0) {
      await game.ninjaNotes.gmPanel.setNotes(history);
    }

    if (game.settings.get(MODULE_ID, "autoOpenGMPanel")) {
      game.ninjaNotes.gmPanel.render({ force: true });
      // Small delay to let the DOM settle before flashing
      setTimeout(() => flashWindow(game.ninjaNotes.gmPanel), 300);
    }

    await createGMMacro();
  } else {
    await createPlayerMacro();
  }
});
