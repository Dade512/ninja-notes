/* eslint-disable no-undef */
const MODULE_ID = "ninja-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

/* ──────────────────────────────────────── */
/* Settings                                  */
/* ──────────────────────────────────────── */
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoOpenGMPanel", {
    name: "Auto-open GM Panel",
    hint: "Open the Secret Notes panel automatically when the world loads (GM only).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "playSound", {
    name: "Play Sound on Note",
    hint: "Play a sound when a secret note arrives.",
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

  // v2.1.2: world scope — macros are Macro documents visible to the whole world;
  // whether to auto-create them is a GM-level setup decision, not per-client.
  // Consistent with the existing pattern of other world-scope config settings
  // (persistHistory, maxNotesPerWindow, autoOpenGMPanel).
  // Default true preserves existing behavior; set false to suppress auto-creation
  // in deployments that manage macros manually.
  game.settings.register(MODULE_ID, "autoCreateMacros", {
    name: "Auto-Create Macros",
    hint: "Automatically create the 'Secret Notes' GM macro and 'Pass a Note' player macro on first load. Duplicate-detection prevents re-creation if they already exist.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // CLIENT scope (v2.3.0 privacy fix): note history lives only in the GM's browser
  // local storage and is never replicated to players. Only the GM writes it
  // (saveHistory is GM-guarded) and reads it (loadHistory runs only inside the GM
  // panel path), so client scope keeps it private. Closes the prior world-scope leak
  // where any player could read persisted notes via game.settings.get(..., "history").
  // Trade-off: history is now per-GM-browser (persists across reloads, not across machines).
  game.settings.register(MODULE_ID, "history", {
    scope: "client",
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

/* ──────────────────────────────────────── */
/* History Validation                        */
/* ──────────────────────────────────────── */

/**
 * Light validation for a persisted note entry.
 * Returns false and causes the entry to be silently dropped if any
 * required field is missing or of the wrong type. senderColor is
 * optional (defaulted at render time) and not validated here.
 *
 * @param {*} entry
 * @returns {boolean}
 */
function _isValidNoteEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  // ts must be a finite number (Unix ms timestamp)
  if (typeof entry.ts !== "number" || !isFinite(entry.ts)) return false;
  // senderId must be a non-empty string
  if (typeof entry.senderId !== "string" || !entry.senderId) return false;
  // senderName must be a non-empty string
  if (typeof entry.senderName !== "string" || !entry.senderName) return false;
  // message must be a non-empty string (whitespace-only is rejected)
  if (typeof entry.message !== "string" || !entry.message.trim()) return false;
  return true;
}

async function loadHistory() {
  if (!game.settings.get(MODULE_ID, "persistHistory")) return [];
  try {
    const raw = game.settings.get(MODULE_ID, "history");
    if (!Array.isArray(raw)) return [];

    // Filter malformed entries first, then enforce limit.
    // Enforcing limit on load (not just save) handles entries stored before
    // the historyLimit setting was lowered, and avoids sending a bloated
    // array to the GM panel on worlds that skipped a cleanup cycle.
    const limit = Number(game.settings.get(MODULE_ID, "historyLimit")) || 100;
    const valid = raw.filter(_isValidNoteEntry);

    if (valid.length < raw.length) {
      console.warn(
        `${MODULE_ID} | Dropped ${raw.length - valid.length} malformed history entries on load.`
      );
    }

    return valid.slice(-limit);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to load history:`, error);
    return [];
  }
}

async function saveHistory(notes) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "persistHistory")) return;
  try {
    const limit = Number(game.settings.get(MODULE_ID, "historyLimit")) || 100;
    // Validate before saving — defends against any in-memory corruption
    // that might have slipped in through addNote or external API calls.
    const trimmed = notes.filter(_isValidNoteEntry).slice(-limit);
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
    // Military noir: telegraph click / radio static cue
    // Place your preferred .mp3/.ogg in modules/ninja-notes/sounds/
    // Recommended: short telegraph key click, typewriter bell, or radio static burst
    const audio = new Audio(`modules/${MODULE_ID}/sounds/transmissions.mp3`);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch {
    // Ignore audio errors
  }
}

/**
 * Distinct cue for a GM reply arriving on a player's client — a different sound
 * from the incoming-note transmission so a reply is recognizable by ear. Gated
 * on the same per-client playSound setting.
 */
function playReplySound() {
  if (!game.settings.get(MODULE_ID, "playSound")) return;
  try {
    const audio = new Audio(`modules/${MODULE_ID}/sounds/note.mp3`);
    audio.volume = 0.5;
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
/* DOM Helper — context menu userId          */
/* ──────────────────────────────────────── */

/**
 * Read the userId from a player-list <li> element regardless of whether
 * Foundry hands us a native HTMLElement or a jQuery wrapper.
 *
 * v13 context menu hooks pass native HTMLElement. Older compat shims and
 * some module wrappers still pass jQuery objects. We guard the jQuery path
 * with globalThis.jQuery so we never assume jQuery is present.
 *
 * Three cases, in priority order:
 *   1. HTMLElement  → li.dataset.userId  (v13 standard)
 *   2. jQuery       → li.data("userId")  (legacy, guarded by jQuery check)
 *   3. Array-like   → li[0].dataset.userId  (defensive fallback)
 *
 * Returns null if no userId can be read.
 *
 * @param {HTMLElement|jQuery|*} li
 * @returns {string|null}
 */
function _getListItemUserId(li) {
  if (!li) return null;

  // Case 1: native HTMLElement — v13 canonical path
  if (li instanceof HTMLElement) {
    return li.dataset.userId ?? null;
  }

  // Case 2: jQuery wrapper — only attempt if jQuery is actually present
  if (globalThis.jQuery && li instanceof globalThis.jQuery) {
    return li.data("userId") ?? null;
  }

  // Case 3: array-like wrapper without jQuery (e.g. a shim or a plain
  // object with numeric indices). Try unwrapping [0] defensively.
  const inner = li?.[0];
  if (inner instanceof HTMLElement) {
    return inner.dataset.userId ?? null;
  }

  return null;
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
    position: { width: 420, height: 500 },
    window: {
      title: "Secret Notes",
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
      clearNotes: NinjaNotesGMPanel._onClearNotes,
      dismissNote: NinjaNotesGMPanel._onDismissNote,
      replyNote: NinjaNotesGMPanel._onReplyNote
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
      notes: this.notes.map((note, index) => ({
        ...note,
        index,
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
   * Dismiss a specific note by index.
   * Actively splices from the array and persists to game.settings
   * to prevent setting size bloat over long sessions.
   */
  async dismissNote(index) {
    const idx = Number(index);
    if (isNaN(idx) || idx < 0 || idx >= this.notes.length) return;
    this.notes.splice(idx, 1);
    await saveHistory(this.notes);
    this.render({ force: true });
  }

  /**
   * Header button action: Clear all notes
   */
  static async _onClearNotes() {
    await this.clearNotes();
  }

  /**
   * Per-note dismiss action (data-action="dismissNote")
   */
  static async _onDismissNote(event, target) {
    const noteIndex = target?.dataset?.noteIndex;
    if (noteIndex != null) {
      await this.dismissNote(noteIndex);
    }
  }

  /**
   * Per-note reply action (data-action="replyNote"): open the GM reply dialog
   * for the note's sender.
   */
  static async _onReplyNote(event, target) {
    const idx = Number(target?.dataset?.noteIndex);
    if (Number.isNaN(idx) || idx < 0 || idx >= this.notes.length) return;
    await openReplyDialog(this.notes[idx]);
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
      case "reply":
        await handleIncomingReply(data.payload);
        break;
    }
  });
}

/**
 * Player-side handler for a GM reply. Only the targeted player acts (others
 * ignore it); the GM never receives its own emit. Shows the reply as a private
 * themed popup (kept out of chat, true to the module) with a distinct chime.
 */
async function handleIncomingReply(payload) {
  if (!payload || payload.targetId !== game.user.id) return;
  const fromName = String(payload.fromName || "The GM").trim() || "The GM";
  const message = String(payload.message || "").trim();
  if (!message) return;

  playReplySound();
  ui.notifications.info(`Reply from ${fromName}.`);

  const escapedMsg = escapeHTML(message);
  const escapedFrom = escapeHTML(fromName);
  const content = `
    <div class="form-group">
      <label style="font-family: 'Oswald', 'Impact', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px;">
        <i class="fas fa-feather"></i> Reply from ${escapedFrom}
      </label>
      <p style="white-space: pre-wrap; word-wrap: break-word; margin-top: 8px; padding: 10px 12px; background: rgba(0,0,0,0.15); border-left: 3px solid #b8943e; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.55; color: #c8ccd4;">${escapedMsg}</p>
    </div>
  `;

  try {
    await foundry.applications.api.DialogV2.prompt({
      window: { title: "A Reply Arrives" },
      content,
      ok: { icon: "fas fa-check", label: "Acknowledged" },
      rejectClose: false
    });
  } catch {
    // Dialog dismissed — nothing to do.
  }
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
    ui.notifications.info(`Secret note from ${sender.name}`);
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
    ui.notifications.warn("No GM is online — notes are delivered live and aren't stored, so this won't reach anyone. Send it again once a GM is connected.");
  }

  const gmStatus = isGMOnline() ? "Yes" : "No";
  const statusColor = isGMOnline() ? "#5a9a5a" : "#8b3a3a";
  const escaped = foundry.utils.escapeHTML?.(prefill) ?? escapeHTML(prefill);

  const content = `
    <div class="form-group">
      <label style="font-family: 'Oswald', 'Impact', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px;">Your Note:</label>
      <textarea name="ninja-note-text" rows="6" style="width:100%; resize: vertical; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.5;">${escaped}</textarea>
    </div>
    <p style="font-size: 0.85em; opacity: 0.7; margin-top: 8px; font-family: 'IBM Plex Mono', 'Courier New', monospace;">
      <i class="fas fa-eye"></i> GM Online: <span style="color: ${statusColor}; font-weight: 600;">${gmStatus}</span>
    </p>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Pass a Note" },
    content,
    ok: {
      icon: "fas fa-scroll",
      label: "Send",
      callback: (event, button) => {
        // In v13 DialogV2 the 3rd callback arg is the DialogV2 instance (no
        // querySelector); read the field from the button's own form instead.
        const textarea = button.form?.querySelector('textarea[name="ninja-note-text"]');
        return textarea?.value?.trim() || "";
      }
    },
    rejectClose: false
  });

  if (result) sendNinjaNote(result);
}

/**
 * GM-side: open a dialog to reply privately to the player who sent a note. The
 * reply is delivered live over the socket (there is no player-side persistence),
 * so if the player is offline we warn and abort rather than lose it silently.
 * @param {{senderId:string, senderName?:string, message?:string}} note
 */
async function openReplyDialog(note) {
  if (!game.user.isGM || !note?.senderId) return;
  const target = game.users.get(note.senderId);
  if (!target) {
    ui.notifications.warn("That player no longer exists.");
    return;
  }
  if (!target.active) {
    ui.notifications.warn(`${target.name} is offline — they won't receive a reply right now.`);
    return;
  }

  const escapedName = escapeHTML(note.senderName || target.name);
  const escapedMsg = escapeHTML(note.message || "");
  const content = `
    <p style="font-size: 11px; opacity: 0.7; margin: 0 0 6px; font-family: 'IBM Plex Mono', 'Courier New', monospace;">
      <i class="fas fa-reply"></i> Replying to <strong>${escapedName}</strong>
    </p>
    <blockquote style="margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid #5c6370; background: rgba(0,0,0,0.12); font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 11px; color: #9aa0ab; white-space: pre-wrap; word-wrap: break-word;">${escapedMsg}</blockquote>
    <div class="form-group">
      <label style="font-family: 'Oswald', 'Impact', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px;">Your Reply:</label>
      <textarea name="ninja-reply-text" rows="5" style="width:100%; resize: vertical; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.5;"></textarea>
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Reply to ${target.name}` },
    content,
    ok: {
      icon: "fas fa-feather",
      label: "Send Reply",
      callback: (event, button) => {
        // v13 DialogV2: 3rd arg is the instance (no querySelector); use the form.
        const textarea = button.form?.querySelector('textarea[name="ninja-reply-text"]');
        return textarea?.value?.trim() || "";
      }
    },
    rejectClose: false
  });

  if (!result) return;
  game.socket.emit(SOCKET_NAME, {
    type: "reply",
    payload: {
      targetId: note.senderId,
      fromName: game.user.name,
      message: String(result).trim(),
      ts: Date.now()
    }
  });
  ui.notifications.info(`Reply sent to ${target.name}.`);
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

  ui.notifications.info("Note sent.");
}

/* ──────────────────────────────────────── */
/* Auto-Create Macros                        */
/* ──────────────────────────────────────── */
async function createGMMacro() {
  const macroName = "\u{1F4DC} Secret Notes";
  const existing = game.macros.find(m =>
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (existing) return;

  // Clean up old macro name if it exists
  const oldMacro = game.macros.find(m =>
    m.name === "\u{1F977} Ninja Notes" && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (oldMacro) {
    try { await oldMacro.delete(); } catch { /* ignore */ }
  }

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
    ui.notifications.info("Secret Notes GM macro created.");
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to create GM macro:`, error);
  }
}

async function createPlayerMacro() {
  const macroName = "\u{1F4DC} Pass a Note";
  const existing = game.macros.find(m =>
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (existing) return;

  // Clean up old macro name if it exists
  const oldMacro = game.macros.find(m =>
    m.name === "\u{1F4DD} Send Ninja Note" && m.getFlag(MODULE_ID, "autoCreated")
  );
  if (oldMacro) {
    try { await oldMacro.delete(); } catch { /* ignore */ }
  }

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
    ui.notifications.info("Pass a Note macro created.");
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

    // /nn or /ninja command — still works, same shortcuts
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
        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 12px;">
          <h4 style="font-family: 'Oswald', 'Impact', sans-serif; text-transform: uppercase; letter-spacing: 0.05em;"><i class="fas fa-scroll"></i> Secret Notes — Help</h4>
          <p><strong>Commands:</strong></p>
          <ul>
            <li><code>/nn your message</code> or <code>/ninja your message</code> — Pass a secret note to the GM</li>
            <li>Right-click the GM in the Players list → <strong>Pass a Note</strong></li>
            <li><code>/nnhelp</code> — Show this help</li>
          </ul>
          <p><i class="fas fa-feather"></i> The GM can reply privately — replies pop up for you with a chime, never in chat.</p>
          <p><strong>Limit:</strong> ${limit} notes per minute</p>
          <p><strong>GM Online:</strong> ${gmOnline ? "\u{1F7E2} Yes" : "\u{1F534} No"}</p>
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
      name: "Pass a Note",
      icon: '<i class="fas fa-scroll"></i>',
      condition: (li) => {
        // v2.1.2: use _getListItemUserId helper to safely handle both
        // native HTMLElement (v13) and jQuery wrapper (legacy compat shims).
        const userId = _getListItemUserId(li);
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
        ui.notifications.warn("Only GMs can open the Secret Notes panel.");
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

    // v2.1.2: gate macro creation on autoCreateMacros setting.
    // Duplicate-detection inside each create function means this is
    // idempotent when true; setting to false suppresses creation entirely
    // for deployments that manage macros manually.
    if (game.settings.get(MODULE_ID, "autoCreateMacros")) {
      await createGMMacro();
    }
  } else {
    if (game.settings.get(MODULE_ID, "autoCreateMacros")) {
      await createPlayerMacro();
    }
  }

  console.log(`${MODULE_ID} | Secret Notes v2.3.0 ready`);
});
