/* eslint-disable no-undef */
const MODULE_ID = "ninja-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

/* ------------------------------------ */
/* Settings                              */
/* ------------------------------------ */
Hooks.once("init", () => {
  // Core settings
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

  // Throttling settings
  game.settings.register(MODULE_ID, "maxNotesPerWindow", {
    name: "Max Notes per Minute",
    hint: "How many notes a player can send per minute.",
    scope: "world", 
    config: true, 
    type: Number, 
    default: 3,
    range: { min: 1, max: 10, step: 1 }
  });

  // Persistence settings
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

  // Hidden storage
  game.settings.register(MODULE_ID, "history", {
    scope: "world", 
    config: false, 
    type: Object, 
    default: []
  });

  // Initialize global reference
  game.ninjaNotes = { gmPanel: null };
});

/* ------------------------------------ */
/* Utilities                             */
/* ------------------------------------ */
class ThrottleManager {
  constructor() {
    this.trackers = new Map();
  }

  isThrottled(userId, limit = 3, windowMs = 60000) {
    const now = Date.now();
    const history = this.trackers.get(userId) || [];
    
    // Clean old entries
    const recent = history.filter(time => now - time < windowMs);
    
    if (recent.length >= limit) {
      return true;
    }
    
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
  const windowMs = 60000; // Fixed 1 minute window
  return { limit, windowMs };
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function flashWindow(app) {
  if (!app?.element?.[0]) return;

  // Ensure window is visible and on-screen
  try {
    app.setPosition({ left: 120, top: 120 });
    app.bringToTop?.();
  } catch (error) {
    // Ignore positioning errors
  }

  // Add flash effect
  const element = app.element[0];
  element.classList.remove("nn-flash");
  void element.offsetWidth; // Force reflow
  element.classList.add("nn-flash");
  
  setTimeout(() => element.classList.remove("nn-flash"), 2000);
}

function playNotificationSound() {
  if (!game.settings.get(MODULE_ID, "playSound")) return;
  
  try {
    const audio = new Audio(`modules/${MODULE_ID}/sounds/note.mp3`);
    audio.volume = 0.6;
    audio.play().catch(() => {
      // Ignore audio failures (common in browsers with strict autoplay policies)
    });
  } catch (error) {
    // Ignore audio errors
  }
}

/* ------------------------------------ */
/* GM Panel                              */
/* ------------------------------------ */
class NinjaNotesGMPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ninja-notes-gm-panel",
      title: "Ninja Notes",
      template: `modules/${MODULE_ID}/templates/gm-panel.hbs`,
      width: 400,
      height: 500,
      resizable: true,
      classes: ["ninja-notes-app"]
    });
  }

  constructor(options = {}) {
    super(options);
    this.notes = [];
  }

  getData() {
    return {
      notes: this.notes.map(note => ({
        ...note,
        timestamp: formatTimestamp(note.ts)
      }))
    };
  }

  async setNotes(notes) {
    this.notes = Array.isArray(notes) ? notes : [];
    this.render(true);
  }

  async addNote(note) {
    this.notes.push(note);
    await saveHistory(this.notes);
    this.render(true);
  }

  async clearNotes() {
    this.notes = [];
    await saveHistory(this.notes);
    this.render(true);
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    buttons.unshift({
      label: "Clear",
      class: "clear-notes",
      icon: "fas fa-trash",
      onclick: () => this.clearNotes()
    });
    return buttons;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".clear-notes").on("click", () => this.clearNotes());
  }
}

/* ------------------------------------ */
/* Socket Handlers                       */
/* ------------------------------------ */
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
  
  // Check GM-side throttling
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
    senderColor: sender.color,
    message: String(payload.message || "").trim()
  };

  if (!note.message) return;

  // Add note to panel
  const panel = game.ninjaNotes.gmPanel;
  if (panel) {
    await panel.addNote(note);
    
    // Show notification and effects
    ui.notifications.info(`Ninja Note from ${sender.name}`);
    playNotificationSound();
    
    // Open and flash panel
    panel.render(true);
    flashWindow(panel);
  }
}

function handleThrottleNotification(payload) {
  const { targetId, retryMs } = payload || {};
  if (targetId !== game.user.id) return;
  
  const seconds = Math.ceil(Number(retryMs || 60000) / 1000);
  ui.notifications.warn(`Sending too fast! Wait ${seconds} seconds.`);
}

/* ------------------------------------ */
/* Player Interface                      */
/* ------------------------------------ */
function openNoteDialog(prefill = "") {
  if (!isGMOnline()) {
    ui.notifications.warn("No GM is online. Your note will only be seen when a GM logs in.");
  }

  new Dialog({
    title: "Send Ninja Note",
    content: `
      <div class="form-group">
        <label>Secret message to GM:</label>
        <textarea id="ninja-note-text" rows="6" style="width:100%; resize: vertical;">${foundry.utils.escapeHTML(prefill)}</textarea>
      </div>
      <p style="font-size: 0.9em; color: #666; margin-top: 8px;">
        <i class="fas fa-info-circle"></i> GM Online: ${isGMOnline() ? "Yes" : "No"}
      </p>
    `,
    buttons: {
      send: {
        icon: '<i class="fas fa-paper-plane"></i>',
        label: "Send",
        callback: (html) => {
          const message = html.find("#ninja-note-text").val()?.trim();
          if (message) sendNinjaNote(message);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "send"
  }).render(true);
}

function sendNinjaNote(message) {
  const { limit, windowMs } = getThrottleConfig();
  
  // Client-side throttle check
  if (clientThrottle.isThrottled(game.user.id, limit, windowMs)) {
    const remaining = Math.ceil(clientThrottle.getRemainingTime(game.user.id, windowMs) / 1000);
    ui.notifications.warn(`Please wait ${remaining} seconds before sending another note.`);
    return;
  }

  // Send the note
  game.socket.emit(SOCKET_NAME, {
    type: "newNote",
    payload: {
      senderId: game.user.id,
      message: String(message).trim()
    }
  });

  ui.notifications.info("Ninja Note sent!");
}

/* ------------------------------------ */
/* Auto-Create Macros                    */
/* ------------------------------------ */
async function createGMMacro() {
  const macroName = "🥷 Ninja Notes";
  
  // Check if macro already exists
  const existing = game.macros.find(m => 
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  
  if (existing) return;

  try {
    await Macro.create({
      name: macroName,
      type: "script",
      img: "icons/sundries/scrolls/scroll-bound-red.webp",
      command: `// Open Ninja Notes GM Panel
const mod = game.modules.get("ninja-notes");
if (mod?.api?.open) {
  mod.api.open();
} else {
  ui.notifications.error("Ninja Notes module not available.");
}`,
      flags: { [MODULE_ID]: { autoCreated: true } }
    });
    
    ui.notifications.info("Ninja Notes GM macro created!");
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to create GM macro:`, error);
  }
}

async function createPlayerMacro() {
  const macroName = "📝 Send Ninja Note";
  
  const existing = game.macros.find(m => 
    m.name === macroName && m.getFlag(MODULE_ID, "autoCreated")
  );
  
  if (existing) return;

  try {
    await Macro.create({
      name: macroName,
      type: "script", 
      img: "icons/sundries/documents/document-sealed-red.webp",
      command: `// Send Ninja Note to GM
const mod = game.modules.get("ninja-notes");
if (mod?.api?.sendNote) {
  mod.api.sendNote();
} else {
  ui.notifications.error("Ninja Notes module not available.");
}`,
      flags: { [MODULE_ID]: { autoCreated: true } }
    });
    
    ui.notifications.info("Ninja Notes player macro created!");
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to create player macro:`, error);
  }
}

/* ------------------------------------ */
/* Chat Commands                         */
/* ------------------------------------ */
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
      const { limit, windowMs } = getThrottleConfig();
      const gmOnline = isGMOnline();
      
      const helpText = `
        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px;">
          <h4><i class="fas fa-scroll"></i> Ninja Notes Help</h4>
          <p><strong>Commands:</strong></p>
          <ul>
            <li><code>/nn your message</code> - Send a secret note to the GM</li>
            <li><code>/nnhelp</code> - Show this help</li>
          </ul>
          <p><strong>Limits:</strong> ${limit} notes per minute</p>
          <p><strong>GM Status:</strong> ${gmOnline ? "🟢 Online" : "🔴 Offline"}</p>
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

/* ------------------------------------ */
/* Context Menu                          */
/* ------------------------------------ */
function setupContextMenu() {
  Hooks.on("getUserContextOptions", (_playerList, options) => {
    if (game.user.isGM) return;
    
    options.push({
      name: "Send Ninja Note",
      icon: '<i class="fas fa-scroll"></i>',
      condition: (li) => {
        const userId = li?.data("userId");
        return game.users.get(userId)?.isGM === true;
      },
      callback: () => openNoteDialog()
    });
  });
}

/* ------------------------------------ */
/* Module API                            */
/* ------------------------------------ */
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
        panel.render(true);
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

/* ------------------------------------ */
/* Ready Hook - Initialize Everything    */
/* ------------------------------------ */
Hooks.on("ready", async () => {
  setupModuleAPI();
  setupSocketHandlers();
  setupChatCommands();
  setupContextMenu();

  if (game.user.isGM) {
    // Initialize GM panel
    if (!game.ninjaNotes.gmPanel) {
      game.ninjaNotes.gmPanel = new NinjaNotesGMPanel();
    }

    // Load existing notes
    const history = await loadHistory();
    if (history.length > 0) {
      await game.ninjaNotes.gmPanel.setNotes(history);
    }

    // Auto-open panel if enabled
    if (game.settings.get(MODULE_ID, "autoOpenGMPanel")) {
      game.ninjaNotes.gmPanel.render(true);
      flashWindow(game.ninjaNotes.gmPanel);
    }

    // Create GM macro
    await createGMMacro();
  } else {
    // Create player macro
    await createPlayerMacro();
  }
});
