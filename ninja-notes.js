/* eslint-disable no-undef */
const MODULE_ID = "ninja-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

/* ------------------------------------ */
/* Settings                              */
/* ------------------------------------ */
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

  game.settings.register(MODULE_ID, "history", {
    scope: "world", config: false, type: Object, default: []
  });

  // global ref
  game.ninjaNotes = { gmPanel: null };
});

/* ------------------------------------ */
/* Helpers                               */
/* ------------------------------------ */
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
  if (!game.settings.get(MODULE_ID, "persistHistory")) return [];
  const h = game.settings.get(MODULE_ID, "history") ?? [];
  return Array.isArray(h) ? h : [];
}

async function saveHistory(notes) {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, "persistHistory")) return;
  const cap = Math.max(1, Number(game.settings.get(MODULE_ID, "persistHistoryLimit") || 200));
  const trimmed = notes.slice(-cap);
  await game.settings.set(MODULE_ID, "history", trimmed);
}

function anyGMActive() {
  return game.users?.some(u => u.isGM && u.active);
}

/** Force the window on-screen & flash */
function ensureVisibleAndFlash(app) {
  try {
    // force a safe position (top-left quadrant)
    app.setPosition({ left: 120, top: 120, width: 400, height: 500 });
  } catch (e) {}

  // bring to top
  try { app.bringToTop?.(); } catch (e) {}

  // flash the root element
  const el = app.element?.[0] || document.getElementById("ninja-notes-gm-panel") || document.querySelector(".ninja-notes-app");
  if (!el) return;
  el.classList.remove("nn-flash");
  void el.offsetWidth; // restart animation
  el.classList.add("nn-flash");
  setTimeout(() => el.classList.remove("nn-flash"), 3000);
}

/** Open/Focus the panel */
function openPanelAndFlash() {
  if (!game.user.isGM) return;
  if (!game.ninjaNotes?.gmPanel) game.ninjaNotes.gmPanel = new NinjaNotesGMPanel();
  const p = game.ninjaNotes.gmPanel;
  p.render(true);
  ensureVisibleAndFlash(p);
}

/* ------------------------------------ */
/* GM Panel (classic Application)        */
/* ------------------------------------ */
class NinjaNotesGMPanel extends Application {
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
      this.notes = [];
      await saveHistory(this.notes);
      this.render(true);
    });
  }
}

/* ------------------------------------ */
/* State                                 */
/* ------------------------------------ */
const gmThrottle = new Map();
const clientThrottle = new Map();

/* ------------------------------------ */
/* Ready: GM panel + socket + persistence */
/* ------------------------------------ */
Hooks.on("ready", async () => {
  // expose a tiny API for macros/console
  const mod = game.modules.get(MODULE_ID);
  if (mod) { mod.api ??= {}; mod.api.open = () => openPanelAndFlash(); }

  // GM boot
  if (game.user.isGM) {
    if (!game.ninjaNotes.gmPanel) game.ninjaNotes.gmPanel = new NinjaNotesGMPanel();

    const existing = await loadHistory();
    if (existing?.length) await game.ninjaNotes.gmPanel.setNotes(existing);

    if (game.settings.get(MODULE_ID, "autoOpenGMPanel")) {
      game.ninjaNotes.gmPanel.render(true);
      ensureVisibleAndFlash(game.ninjaNotes.gmPanel);
    }

    // GM listens for incoming notes
    game.socket.on(SOCKET_NAME, async (data) => {
      if (data?.type !== "newNote") return;

      const { limit, windowMs } = throttleConfig();
      const senderId = data.payload?.senderId;
      if (!senderId) return;

      if (isThrottled(gmThrottle, senderId, limit, windowMs)) {
        game.socket.emit(SOCKET_NAME, { type: "throttled", payload: { targetId: senderId, retryMs: windowMs } });
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

      openPanelAndFlash();
    });
  }

  // All clients listen for throttling notices
  game.socket.on(SOCKET_NAME, (data) => {
    if (data?.type !== "throttled") return;
    const { targetId, retryMs } = data.payload || {};
    if (targetId === game.user.id) {
      const sec = Math.ceil(Number(retryMs || 60000) / 1000);
      ui.notifications.warn(`You're sending notes too fast. Try again in a moment (window ${sec}s).`);
    }
  });
});

/* ------------------------------------ */
/* Player UX: context menu on GM         */
/* ------------------------------------ */
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
  if (game.user.isGM) return;
  options.push({
    name: "Send Ninja Note to GM",
    icon: '<i class="fa-solid fa-scroll"></i>',
    condition: (li) => {
      const userId = li?.data("userId");
      return game.users.get(userId)?.isGM === true;
    },
    callback: () => openNinjaNoteDialog()
  });
});

/* ------------------------------------ */
/* Slash commands: /nn, /ninja, /nnhelp  */
/* ------------------------------------ */
Hooks.on("chatMessage", (_log, content) => {
  const raw = String(content ?? "").trim();

  let m = raw.match(/^\/(nn|ninja)\s+(.*)$/i);
  if (m) {
    const msg = m[2].trim();
    if (!msg) return false;
    sendNinjaNote(msg);
    return false;
  }

  m = raw.match(/^\/nnhelp$/i);
  if (m) {
    const throttle = throttleConfig();
    const gmOnline = anyGMActive();
    const html = `
      <p><b>Ninja Notes</b> — send secret notes to the GM.</p>
      <ul>
        <li><code>/nn your message</code> or right-click a GM → <i>Send Ninja Note to GM</i></li>
        <li>Throttle: ${throttle.limit} notes / ${Math.round(throttle.windowMs/1000)}s</li>
        <li>GM online right now: ${gmOnline ? "Yes" : "No (note will only be seen when a GM is present)"}</li>
      </ul>`;
    ChatMessage.create({ content: html, whisper: [game.user.id] });
    return false;
  }
});

/* ------------------------------------ */
/* Toolbar: top-level Ninja Notes icon   */
/* ------------------------------------ */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  if (controls.some(c => c.name === "ninja-notes")) return;
  controls.push({
    name: "ninja-notes",
    title: "Ninja Notes",
    icon: "fa-solid fa-scroll",
    layer: null,
    visible: true,
    tools: [{
      name: "open",
      title: "Open Ninja Notes",
      icon: "fa-solid fa-scroll",
      button: true,
      onClick: () => openPanelAndFlash()
    }]
  });
});

/* ------------------------------------ */
/* Send helper + client-side throttle    */
/* ------------------------------------ */
function sendNinjaNote(message) {
  const { limit, windowMs } = throttleConfig();
  const key = game.user.id;

  if (isThrottled(clientThrottle, key, limit, windowMs)) {
    ui.notifications.warn("You're sending notes too fast. Try again shortly.");
    return;
  }

  if (!anyGMActive()) {
    ui.notifications.warn("No GM is currently online. Your Ninja Note will only be seen when a GM is present.");
  }

  const payload = { senderId: game.user.id, message: String(message) };
  game.socket.emit(SOCKET_NAME, { type: "newNote", payload });
  ui.notifications.info("Ninja Note sent!");
}
