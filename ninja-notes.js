const MODULE_ID = "ninja-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

// ---------- Settings ----------
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoOpenGMPanel", {
    name: "Auto-open GM Panel",
    hint: "Open the Ninja Notes panel automatically when the world loads (GM only).",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register(MODULE_ID, "playSound", {
    name: "Play Sound on Note (Client)",
    hint: "Play a local chime when a Ninja Note arrives (affects your client only).",
    scope: "client", config: true, type: Boolean, default: true
  });

  // Throttling (world-level, enforced by GM; players also precheck)
  game.settings.register(MODULE_ID, "maxNotesPerWindow", {
    name: "Throttle: Max Notes per Window",
    hint: "How many notes a player can send within the time window.",
    scope: "world", config: true, type: Number, default: 3,
    range: { min: 1, max: 20, step: 1 }
  });

  game.settings.register(MODULE_ID, "windowSeconds", {
    name: "Throttle: Window (seconds)",
    hint: "Length of the sliding window for throttling.",
    scope: "world", config: true, type: Number, default: 60,
    range: { min: 10, max: 600, step: 10 }
  });

  // Persistence
  game.settings.register(MODULE_ID, "persistHistory", {
    name: "Persist Session History",
    hint: "Store Ninja Notes in world data so GMs see them after reload.",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register(MODULE_ID, "persistHistoryLimit", {
    name: "History Limit",
    hint: "Maximum notes to keep if persistence is enabled.",
    scope: "world", config: true, type: Number, default: 200,
    range: { min: 10, max: 1000, step: 10 }
  });

  // Internal: stored note array (GM writes)
  game.settings.register(MODULE_ID, "history", {
    scope: "world", config: false, type: Object, default: []
  });

  // Global ref
  game.ninjaNotes = { gmPanel: null };
});

// ---------- Helpers ----------
function throttleConfig() {
  const limit = Math.max(1, Number(game.settings.get(MODULE_ID, "maxNotesPerWindow") || 3));
  const windowMs = Math.max(5, Number(game.settings.get(MODULE_ID, "windowSeconds") || 60)) * 1000;
  return { limit, windowMs };
}

function isThrottled(map, key, limit, windowMs) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) return true;
  arr.push(now);
  map.set(key, arr);
  return false;
}

async function loadHistory() {
  const persist = game.settings.get(MODULE_ID, "persistHistory");
  if (!persist) return [];
  const h = game.settings.get(MODULE_ID, "history") ?? [];
  return Array.isArray(h) ? h : [];
}

async function saveHistory(notes) {
  if (!game.user.isGM) return;
  const persist = game.settings.get(MODULE_ID, "persistHistory");
  if (!persist) return;
  const cap = Math.max(1, Number(game.settings.get(MODULE_ID, "persistHistoryLimit") || 200));
  const trimmed = notes.slice(-cap);
  await game.settings.set(MODULE_ID, "history", trimmed);
}

/** ---------- GM Panel (V2 with fallback) ---------- */
const AppAPI   = foundry?.applications?.api;
const AppV2    = AppAPI?.ApplicationV2;
const HBSMixin = AppAPI?.HandlebarsApplicationMixin;

class NinjaNotesGMPanelV2 extends HBSMixin(AppV2) {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: "ninja-notes-gm-panel",
    classes: ["ninja-notes-app"],
    tag: "section",
    template: `modules/${MODULE_ID}/templates/gm-panel.hbs`,
    window: { title: "Ninja Notes", resizable: true, width: 400, height: 500 }
  };

  constructor(options = {}) {
    super(options);
    this.notes = [];
  }

  /** Handlebars mixin expects context from _prepareContext (not getData) */
  async _prepareContext(_options) {
    return { notes: this.notes };
  }

  /** Button in template still works; keep listeners */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".clear-notes").on("click", async () => {
      this.notes = [];
      await saveHistory(this.notes);
      this.render();
    });
  }

  async setNotes(arr) { this.notes = arr; this.render(); }
  async addNote(n)     { this.notes.push(n); await saveHistory(this.notes); this.render(); }
}

/** Open the GM panel (create if needed), bring to top, and flash briefly */
function openPanelAndFlash() {
  if (!game.user.isGM) return;

  // Ensure panel exists
  if (!game.ninjaNotes?.gmPanel) game.ninjaNotes.gmPanel = new GMPanelClass();
  const p = game.ninjaNotes.gmPanel;

  // Render (V2 vs V1)
  if (foundry?.applications?.api?.ApplicationV2) p.render();
  else p.render(true);

  // Try to focus/top
  try { p.bringToTop?.(); } catch (e) {}

  // Flash the window root
  setTimeout(() => {
    const el =
      document.getElementById("ninja-notes-gm-panel") ||
      document.querySelector(".ninja-notes-app");
    if (!el) return;
    el.classList.remove("nn-flash"); // reset
    // restart animation
    void el.offsetWidth;
    el.classList.add("nn-flash");
    setTimeout(() => el.classList.remove("nn-flash"), 3000);
  }, 50);
}

/** Add a GM-only tool button under the Token controls */
Hooks.on("getSceneControlButtons", (controls) => {
  const token = controls.find(c => c.name === "token");
  if (!token) return;

  token.tools.push({
    name: "ninja-notes-open",
    title: "Open Ninja Notes",
    icon: "fas fa-scroll",
    visible: game.user.isGM === true,   // GM only
    button: true,
    onClick: () => openPanelAndFlash()
  });
});

/** Classic fallback stays the same */
class NinjaNotesGMPanelV1 extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ninja-notes-gm-panel",
      title: "Ninja Notes",
      template: `modules/${MODULE_ID}/templates/gm-panel.hbs`,
      width: 400, height: 500, resizable: true, popOut: true,
      classes: ["ninja-notes-app"]
    });
  }
  constructor(options = {}) { super(options); this.notes = []; }
  getData() { return { notes: this.notes }; }
  async setNotes(arr) { this.notes = arr; this.render(true); }
  async addNote(n) { this.notes.push(n); await saveHistory(this.notes); this.render(true); }
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    buttons.unshift({
      label: "Clear", class: "clear-notes", icon: "fas fa-trash",
      onclick: async () => { this.notes = []; await saveHistory(this.notes); this.render(true); }
    });
    return buttons;
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".clear-notes").on("click", async () => {
      this.notes = []; await saveHistory(this.notes); this.render(true);
    });
  }
}

/** Use V2 only if both API and mixin exist; else fall back cleanly */
const GMPanelClass = (AppV2 && HBSMixin) ? NinjaNotesGMPanelV2 : NinjaNotesGMPanelV1;

// ---------- State ----------
const gmThrottle = new Map();     // GM-side enforcement: senderId -> timestamps[]
const clientThrottle = new Map(); // Client-side precheck: current user -> timestamps[]

// ---------- Ready: GM socket + panel + persistence ----------
Hooks.on("ready", async () => {
  // GM panel + load history
  if (game.user.isGM) {
    if (!game.ninjaNotes.gmPanel) game.ninjaNotes.gmPanel = new GMPanelClass();

    // Load persisted notes (if enabled)
    const existing = await loadHistory();
    if (existing?.length) await game.ninjaNotes.gmPanel.setNotes(existing);

    if (game.settings.get(MODULE_ID, "autoOpenGMPanel")) {
      if (AppV2) game.ninjaNotes.gmPanel.render(); else game.ninjaNotes.gmPanel.render(true);
    }

    // GM listens for notes
    game.socket.on(SOCKET_NAME, async (data) => {
      if (data?.type !== "newNote") return;

      const { limit, windowMs } = throttleConfig();
      const senderId = data.payload?.senderId;
      if (!senderId) return;

      // Enforce throttle
      if (isThrottled(gmThrottle, senderId, limit, windowMs)) {
        // Inform only the sender (others ignore)
        game.socket.emit(SOCKET_NAME, {
          type: "throttled",
          payload: { targetId: senderId, retryMs: windowMs }
        });
        return;
      }

      const sender = game.users.get(senderId);
      if (!sender) return;

      const noteData = {
        ts: Date.now(),
        senderId,
        senderName: sender.name,
        senderColor: sender.color,
        message: String(data.payload.message ?? "")
      };

      await game.ninjaNotes.gmPanel.addNote(noteData);
      ui.notifications.info(`${sender.name} sent you a Ninja Note!`);

      try {
        if (game.settings.get(MODULE_ID, "playSound")) {
          const src = `modules/${MODULE_ID}/sounds/note.mp3`;
          AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | Audio play failed:`, err);
      }
    });
  }
  
  // Bring panel forward and flash header for a moment
openPanelAndFlash();

  // All clients listen for "throttled" notices
  game.socket.on(SOCKET_NAME, (data) => {
    if (data?.type !== "throttled") return;
    const { targetId, retryMs } = data.payload || {};
    if (targetId === game.user.id) {
      const sec = Math.ceil(Number(retryMs || 60000) / 1000);
      ui.notifications.warn(`You're sending notes too fast. Try again in a moment (window ${sec}s).`);
    }
  });
});

// ---------- Player UX: context menu entry on GM ----------
function openNinjaNoteDialog(prefill = "") {
  new Dialog({
    title: "Send Ninja Note",
    content: `
      <div class="form-group">
        <label>Your secret message to the GM:</label>
        <textarea id="ninja-note-text" rows="6" style="width:100%">${foundry.utils.escapeHTML(prefill)}</textarea>
      </div>
    `,
    buttons: {
      send: {
        icon: '<i class="fas fa-paper-plane"></i>',
        label: "Send",
        callback: (html) => {
          const message = String(html.find("#ninja-note-text").val() ?? "").trim();
          if (!message.length) return;
          sendNinjaNote(message);
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
    },
    default: "send"
  }).render(true);
}

Hooks.on("getUserContextOptions", (_playerList, options) => {
  if (game.user.isGM) return; // players only
  options.push({
    name: "Send Ninja Note to GM",
    icon: '<i class="fas fa-scroll"></i>',
    condition: (li) => {
      const userId = li?.data("userId");
      return game.users.get(userId)?.isGM === true;
    },
    callback: () => openNinjaNoteDialog()
  });
});

// ---------- Slash command: /nn Your message here ----------
Hooks.on("chatMessage", (_log, content, chatData) => {
  const m = String(content ?? "").trim().match(/^\/(nn|ninja)\s+(.*)$/i);
  if (!m) return;
  const msg = m[2].trim();
  if (!msg) return false; // consume silently
  sendNinjaNote(msg);
  return false; // prevent posting to chat
});

// ---------- Send helper with client-side throttle ----------
function sendNinjaNote(message) {
  const { limit, windowMs } = throttleConfig();
  const key = game.user.id;
  if (isThrottled(clientThrottle, key, limit, windowMs)) {
    ui.notifications.warn("You're sending notes too fast. Try again shortly.");
    return;
  }

  const payload = { senderId: game.user.id, message: String(message) };
  game.socket.emit(SOCKET_NAME, { type: "newNote", payload });
  ui.notifications.info("Ninja Note sent!");
}
