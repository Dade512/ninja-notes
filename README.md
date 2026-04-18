# Ninja Notes — Secret Notes

**For Foundry VTT v13.350 + Pathfinder 1e System**

Version 2.1.1 | [GitHub](https://github.com/Dade512/ninja-notes)

---

## What This Module Does

Players can pass secret notes to the GM without using chat. Notes are private, persistent across reloads, and styled to match the Echoes of Baphomet campaign's noir aesthetic. The GM sees all incoming notes in a dedicated panel with per-note dismiss and full history management.

---

## Installation

### Option A: Manual Install

1. Locate your Foundry Data folder:
   - **Windows:** `%LOCALAPPDATA%/FoundryVTT/Data/`
   - **macOS:** `~/Library/Application Support/FoundryVTT/Data/`
   - **Linux:** `~/.local/share/FoundryVTT/Data/`

2. Copy the entire `ninja-notes` folder into `Data/modules/`. Your structure should be:

   ```
   Data/modules/ninja-notes/
   ├── module.json
   ├── ninja-notes.js
   ├── styles/
   │   └── ninja-notes.css
   ├── templates/
   │   └── gm-panel.hbs
   └── sounds/
       └── transmissions.mp3
   ```

3. Launch Foundry → **Settings → Manage Modules** → Enable **"Ninja Notes — Secret Notes"**.

### Option B: Manifest URL

In Foundry's **Add-on Modules** installer, paste:

```
https://raw.githubusercontent.com/Dade512/ninja-notes/main/module.json
```

---

## How It Works

### For Players

There are three ways to pass a note:

**Macro:** A "📜 Pass a Note" macro is auto-created the first time a player logs in. Click it, type your message, hit Send.

**Chat command:** Type `/nn your secret message here` directly in chat. The message is intercepted and sent privately — it never appears in the chat log.

**Context menu:** Right-click the GM's name in the player list → "Pass a Note".

Players see a confirmation ("Note sent.") and a warning if sending too fast (rate-limited to 3 per minute by default).

### For the GM

A "Secret Notes" panel opens automatically on login (configurable). Incoming notes appear with the sender's name, color, and timestamp. Each note displays in monospace font — styled like a handwritten message slipped across the table.

**Per-note dismiss:** Hover over any note to reveal the ✕ button. Clicking it removes that specific note from both the display and the stored settings.

**Clear all:** The trash icon in the panel header wipes all notes at once.

**Sound cue:** An audio notification plays when a note arrives (configurable). Place your preferred .mp3 file at `sounds/transmissions.mp3` — a paper rustle, quill scratch, or soft chime works well.

---

## Chat Commands

| Command | Effect |
|---------|--------|
| `/nn your message` | Send a secret note to the GM |
| `/ninja your message` | Same as `/nn` |
| `/nnhelp` | Show help (whispered to self) |

---

## Settings

All settings are in **Settings → Module Settings → Ninja Notes**.

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-open GM Panel | ✅ On | Open the Secret Notes panel when the world loads (GM only) |
| Play Sound on Note | ✅ On | Play audio when a note arrives (per-client) |
| Max Notes per Minute | 3 | Rate limit per player (1–10) |
| Remember Notes | ✅ On | Persist notes across world reloads |
| Max Stored Notes | 100 | Cap on stored notes (10–500). Oldest are deleted first. |

---

## Macro API

The module exposes an API on the module object:

```javascript
// Open the GM panel (GM only)
game.modules.get("ninja-notes").api.open()

// Open the note dialog (players only)
game.modules.get("ninja-notes").api.sendNote()
```

---

## Styling

The module imports IBM Plex Mono and Oswald fonts directly, so it works standalone. When running alongside baphomet-utils, it picks up the noir theme's CSS variables (`--baph-bg-dark`, `--baph-gold`, etc.) for a seamless look.

### Visual Details

- **Note body:** IBM Plex Mono — monospace dossier aesthetic
- **Sender name:** Oswald, uppercase, player color
- **Timestamps:** IBM Plex Mono, muted
- **Background:** Dark slate (`#181b20`) with lighter note cards
- **Incoming flash:** Gold pulse animation on the panel window
- **Scrollbar:** Slim, dark, gold highlight on hover

---

## Troubleshooting

### Console verification

Open browser console (F12). On a healthy load you should see:

```
ninja-notes | Secret Notes v2.1.1 ready
```

### Notes not arriving

1. Verify both the player AND GM have the module enabled
2. Check that `"socket": true` is in module.json (required for private messaging)
3. The GM must be online — if offline, notes queue until a GM connects

### No sound on note arrival

1. Verify `sounds/transmissions.mp3` exists in the module folder
2. Check **Settings → Module Settings → Ninja Notes → Play Sound on Note** is enabled
3. Browser autoplay policies may block audio until the user has interacted with the page

### Old macros still showing

The module auto-cleans old macro names ("🥷 Ninja Notes" / "📝 Send Ninja Note") on first load. If they persist, delete them manually from the macro hotbar.

---

## Changelog

### v2.1.1
- **Bug fix:** Notification sound path corrected from `transmission.mp3` to `transmissions.mp3` to match the actual file shipped with the module. The 404 was silently swallowed by the audio error handler, so the sound never played. It plays now.

### v2.1.0 (2026-02-21)
- Visual overhaul: monospace dossier font, noir color palette, Oswald headings
- Per-note dismiss button (hover to reveal ✕) — actively removes from stored settings
- Labels updated: "Pass a Note" (player) / "Secret Notes" (GM panel)
- Macros renamed with auto-cleanup of old names
- Gold flash pulse on incoming notes
- Custom scrollbar styling
- Sound file path changed to `sounds/transmission.mp3`

### v2.0.0
- Rewritten for Foundry v13 ApplicationV2 + DialogV2
- Socket-based private messaging (no chat whispers)
- Rate limiting with configurable threshold
- Persistent history with size cap
- Auto-created macros for GM and players
- Chat commands (`/nn`, `/ninja`, `/nnhelp`)
- Context menu integration on player list

---

## License

Private module for the Echoes of Baphomet's Fall campaign.

## Credits

Built for Foundry VTT v13 + Pathfinder 1e system.
