# Ninja Notes — Secret Notes

**For Foundry VTT v13.350 + Pathfinder 1e System**

Version 2.2.1 | [GitHub](https://github.com/Dade512/ninja-notes)

---

## What This Module Does

Players can pass secret notes to the GM without using chat. Notes are private, persistent across reloads, and styled to match the Echoes of Baphomet campaign's noir aesthetic. The GM sees all incoming notes in a dedicated panel with per-note dismiss and full history management — and can **reply privately** to any note (new in v2.2.0), which pops up for that player alone with its own chime, still entirely out of chat.

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
       ├── transmissions.mp3   (incoming-note chime)
       └── note.mp3            (GM-reply chime)
   ```

3. Launch Foundry → **Settings → Manage Modules** → Enable **"Ninja Notes — Secret Notes"**.

### Option B: Manifest URL

In Foundry's **Add-on Modules** installer, paste:

```
https://github.com/Dade512/ninja-notes/releases/latest/download/module.json
```

---

## How It Works

### For Players

There are three ways to pass a note:

**Macro:** A "📜 Pass a Note" macro is auto-created the first time a player logs in (if Auto-Create Macros is enabled). Click it, type your message, hit Send.

**Chat command:** Type `/nn your secret message here` directly in chat. The message is intercepted and sent privately — it never appears in the chat log.

**Context menu:** Right-click the GM's name in the player list → "Pass a Note".

Players see a confirmation ("Note sent.") and a warning if sending too fast (rate-limited to 3 per minute by default).

**Getting a reply:** if the GM replies to your note, it pops up privately on your screen with a distinct chime — never in the chat log. Click **Acknowledged** to dismiss it.

### For the GM

A "Secret Notes" panel opens automatically on login (configurable). Incoming notes appear with the sender's name, color, and timestamp. Each note displays in monospace font — styled like a handwritten message slipped across the table.

**Macro:** A "📜 Secret Notes" GM macro is auto-created on first load (if Auto-Create Macros is enabled), so you can reopen the panel from the hotbar any time you've closed it. Duplicate-detection skips creation if it already exists.

**Reply:** Each note has a **Reply** button. Click it to write a private reply to that player; it's delivered live to their screen (out of chat) with its own chime. If the player is offline you're warned and the reply isn't sent (there's no player-side queue for replies).

**Per-note dismiss:** Hover over any note to reveal the ✕ button. Clicking it removes that specific note from both the display and the stored settings.

**Clear all:** The trash icon in the panel header wipes all notes at once.

**Sound cues:** Audio plays when a note arrives and when a reply lands (configurable, per-client). Drop your preferred `.mp3` files at `sounds/transmissions.mp3` (incoming notes) and `sounds/note.mp3` (GM replies) — a paper rustle, quill scratch, or soft chime works well.

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

| Setting | Scope | Default | Description |
|---------|-------|---------|-------------|
| Auto-open GM Panel | World | ✅ On | Open the Secret Notes panel when the world loads (GM only) |
| Play Sound on Note | Client | ✅ On | Play audio when a note arrives (per-client) |
| Max Notes per Minute | World | 3 | Rate limit per player (1–10) |
| Remember Notes | World | ✅ On | Persist notes across world reloads |
| Max Stored Notes | World | 100 | Cap on stored notes (10–500). Oldest are deleted first. |
| Auto-Create Macros | World | ✅ On | Auto-create the GM and player macros on first load. Disable if managing macros manually. |

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
ninja-notes | Secret Notes v2.2.0 ready
```

### Notes not arriving

1. Verify both the player AND GM have the module enabled
2. Check that `"socket": true` is in module.json (required for private messaging)
3. A GM must be online when the note is sent. Notes are delivered live over the socket and are **not** queued or stored for later — if no GM is connected, the sender is warned and the note reaches no one. Re-send once a GM is online. (The same live-only model applies to GM replies.)

### No sound on note arrival

1. Verify `sounds/transmissions.mp3` exists in the module folder
2. Check **Settings → Module Settings → Ninja Notes → Play Sound on Note** is enabled
3. Browser autoplay policies may block audio until the user has interacted with the page

### Old macros still showing

The module auto-cleans old macro names ("🥷 Ninja Notes" / "📝 Send Ninja Note") on first load. If they persist, delete them manually from the macro hotbar.

### Macros not being created

Check that **Auto-Create Macros** is enabled in module settings. If you've previously disabled it, re-enable it — the duplicate-detection logic will skip creation if macros already exist, so re-enabling is safe.

---

## Changelog

### v2.2.1 — "Honest Ink"
Doc/UX truth fix. No behavior change.

- **Accurate offline-GM warning:** the player send dialog previously warned *"your note will be waiting when they return"* — but notes are delivered live over the socket and are **not** queued or stored. The warning now says the note won't reach anyone until a GM is connected, and to re-send then (matching the live-only reply behavior). README troubleshooting was corrected to match in this release too.
- **Version-truth:** the `ready` console log now reports the correct version.

### v2.2.0 — "The Reply"
GM → player replies, plus housekeeping.

- **Reply to a note (new):** every note in the GM panel now has a **Reply** button. The GM writes a private reply that's delivered live over the socket to that player only — it pops up on their screen (out of chat, true to the module) with its own chime and an **Acknowledged** button. Other players never see it, and the GM never receives its own emit. If the target player is offline the GM is warned and nothing is sent (replies are live-only; there is no player-side queue).
- **Distinct reply chime:** the previously-unused `sounds/note.mp3` is now the reply cue, separate from the `transmissions.mp3` incoming-note sound. Both honor the per-client **Play Sound on Note** setting.
- **Bug fix (also affected note-sending):** the dialog "Send" / "Send Reply" callback read the textarea via `dialog.querySelector(...)`, but in Foundry v13's DialogV2 the callback's third argument is the dialog **instance** (no `querySelector`) — so the call threw and the dialog silently stayed open without sending. Both the player **note-send** dialog and the new reply dialog now read the field from the button's form (`button.form.querySelector(...)`). Confirmed end-to-end live (player received the GM's reply popup + chime).
- **Docs/help sync:** `/nnhelp` now lists the `/ninja` alias and the right-click context-menu path, and mentions replies. README install tree lists `note.mp3`.
- **Installable release:** the manifest/download now point to GitHub release assets (`releases/latest/download/module.{json,zip}`) with `module.json` at the zip root, so Foundry can install/update directly (the old `archive/main.zip` nested the folder and couldn't install).

### v2.1.2 — "The Wax Seal Holds"
Three small hardening patches. No user-facing behavior changes with default settings.

**Optional auto-macro creation (`autoCreateMacros` setting):**
The module previously called `createGMMacro()` / `createPlayerMacro()` unconditionally on every `ready` hook. Added a world-scope setting `autoCreateMacros` (default `true`) that gates both calls. `world` scope is correct here — macros are Macro documents shared across the world, not a per-client preference, and it's consistent with the existing pattern of other world-scope settings (`persistHistory`, `maxNotesPerWindow`). Default `true` preserves existing behavior exactly. Existing duplicate-detection logic is untouched.

**Context menu userId hardening (`_getListItemUserId` helper):**
`setupContextMenu` previously read userId as `li?.dataset?.userId ?? li?.data?.("userId")`. The `li.data("userId")` call is jQuery's API and made an unguarded assumption that jQuery was present and that `li` was a jQuery wrapper. v13 passes native `HTMLElement` to most hook handlers; the `data()` call would silently return `undefined` in that context. Added a `_getListItemUserId(li)` helper with three explicit cases: `HTMLElement` (v13 standard path, reads `dataset.userId`), jQuery wrapper (guarded by `globalThis.jQuery` existence check, calls `.data("userId")`), and a defensive array-like fallback for shim wrappers. Context menu behavior is identical.

**Light history entry validation (`_isValidNoteEntry` helper):**
`loadHistory` previously returned the raw settings array with no per-entry checks, meaning a single malformed entry (missing `ts`, wrong type, empty `message`) could cause render errors in the GM panel. Added `_isValidNoteEntry(entry)` which checks: entry is a non-null object, `ts` is a finite number, `senderId` is a non-empty string, `senderName` is a non-empty string, `message` is a non-empty (non-whitespace) string. Filter applied in both `loadHistory` (with a console warning counting dropped entries) and `saveHistory` (defends against in-memory corruption from external API calls). `historyLimit` is now also enforced on load, not just on save — handles entries stored before the limit setting was lowered.

### v2.1.1
- **Bug fix:** Notification sound path corrected from `transmission.mp3` to `transmissions.mp3` to match the actual file shipped with the module.

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
