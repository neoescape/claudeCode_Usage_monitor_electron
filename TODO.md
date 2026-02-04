# Claude Code Usage Monitor - Development TODO

## Phase 1: Project Setup ✅ Complete
- [x] Electron + React + TypeScript boilerplate creation
- [x] Tailwind CSS configuration
- [x] Basic window creation and settings

## Phase 2: CLI Integration ✅ Complete
- [x] Claude CLI execution module (node-pty)
- [x] /usage output parsing logic
- [x] Per-account config directory management
- [x] Periodic query scheduler

## Phase 3: UI Development ✅ Complete
- [x] Account list component (AccountCard)
- [x] Usage gauge/progress bar component (UsageGauge)
- [x] Account add/remove modal (AddAccountModal)
- [x] Settings screen - refresh interval (SettingsPanel)

## Phase 4: Additional Features ✅ Complete
- [x] Always on top toggle
- [x] System tray minimization
- [x] Usage threshold alerts (80%, 90%, 100%)
- [x] Dark mode (default applied)

---

## Completion Log

### Phase 1 Complete (2026-02-04)
- Electron + React + TypeScript + Tailwind project setup
- electron-vite build configuration
- Basic window (400x500, titlebar, Always on top toggle)
- Dark theme default UI

### Phase 2 Complete (2026-02-04)
- Terminal emulation with node-pty for Claude CLI
- /usage command output parsing (Current session, Weekly usage)
- Account separation via CLAUDE_CONFIG_DIR environment variable
- setInterval-based periodic query scheduler
- IPC communication to send data to renderer

### Phase 3 Complete (2026-02-04)
- AccountCard: Per-account usage card UI
- UsageGauge: Progress bar (color change: 70% yellow, 90% red)
- AddAccountModal: Account add dialog
- SettingsPanel: Refresh interval selection (1/2/3/5 min)
- App.tsx: Overall state management and IPC event handling

### Phase 4 Complete (2026-02-04)
- System tray: Icon, context menu (Open/Refresh/Quit)
- Minimize to tray on window close (macOS)
- Usage threshold alerts: System notification at 80%, 90%, 100%
- Duplicate alert prevention logic

---

## Project Structure

```
ai-usage-monitor/
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron main process
│   │   ├── claude-cli.ts     # Claude CLI integration module
│   │   ├── scheduler.ts      # Periodic query scheduler
│   │   ├── store.ts          # Settings and data store
│   │   └── types.ts          # Type definitions
│   ├── preload/
│   │   ├── index.ts          # Preload script
│   │   └── index.d.ts        # Type definitions
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── index.css
│           └── components/
│               ├── AccountCard.tsx
│               ├── AddAccountModal.tsx
│               ├── SettingsPanel.tsx
│               └── UsageGauge.tsx
├── package.json
├── electron.vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── PLANNING.md
├── README.md
└── TODO.md
```

## Usage

1. `npm install` - Install dependencies
2. `npm run dev` - Run in development mode
3. `npm run build` - Production build
