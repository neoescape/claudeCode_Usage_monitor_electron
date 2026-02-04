# Claude Code Usage Monitor - Planning Document

## Project Goal

A desktop app for real-time monitoring of Claude Code usage (Current session / Weekly limit) across multiple accounts.

## Requirements

- Monitor multiple Claude Code accounts on a single screen
- Auto-refresh at 1-5 minute intervals
- Keep visible on one side of the monitor for constant checking

## Target Accounts

- Work account (1)
- Personal account (1)
- Expandable to N accounts in the future

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Electron |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS |
| State Management | Zustand (lightweight) |
| Data Collection | Node.js child_process (CLI execution) |

## Architecture

```
┌────────────────────────────────────────────────┐
│  Electron Main Process                         │
│  ├── Per-account CLI profile management        │
│  ├── Periodic usage queries (setInterval)      │
│  └── IPC data transmission to Renderer         │
├────────────────────────────────────────────────┤
│  Electron Renderer Process (React)             │
│  ├── Account list UI                           │
│  ├── Usage gauge/progress bar                  │
│  └── Settings (refresh interval, account mgmt) │
└────────────────────────────────────────────────┘
```

## Authentication: CLI Profiles

Use separate Claude config directories for each account:

```bash
# Work account
CLAUDE_CONFIG_DIR=~/.claude-work claude

# Personal account
CLAUDE_CONFIG_DIR=~/.claude-personal claude
```

### Initial Setup (one-time)
1. Click "Add Account" in the app
2. Enter account name (e.g., "Work", "Personal")
3. App creates new directory and runs `claude login`
4. User completes login

### Usage Query
```bash
# Query usage with environment variable specifying directory
CLAUDE_CONFIG_DIR=~/.claude-work claude -p "/usage"
```

---

## Core Features

### 1. Account Management
- Add/remove accounts
- Set account aliases (Work/Personal, etc.)
- Manage config directory paths

### 2. Real-time Monitoring
- Current session usage (%)
- Weekly limit usage (%)
- Last update time
- Auto-refresh (configurable 1-5 minutes)

### 3. UI/UX
- Compact widget form factor
- Always on top option
- Dark/Light mode
- Usage threshold alerts (80%, 90%, 100%)

---

## Development Roadmap

### Phase 1: Project Setup
- [ ] Electron + React + TypeScript boilerplate
- [ ] Tailwind CSS configuration
- [ ] Basic window creation

### Phase 2: CLI Integration
- [ ] Claude CLI execution and output parsing
- [ ] Per-account config directory management
- [ ] Usage data model definition

### Phase 3: UI Development
- [ ] Account list component
- [ ] Usage gauge component
- [ ] Settings screen (interval, account management)

### Phase 4: Additional Features
- [ ] Always on top toggle
- [ ] System tray minimization
- [ ] Usage alerts

---

## Data Structures

```typescript
interface Account {
  id: string;
  name: string;           // "Work", "Personal"
  configDir: string;      // "~/.claude-work"
  isActive: boolean;
}

interface UsageData {
  accountId: string;
  currentSession: number; // 0-100 (%)
  weeklyLimit: number;    // 0-100 (%)
  lastUpdated: Date;
  error?: string;
}

interface AppSettings {
  refreshInterval: number; // 1-5 minutes (milliseconds)
  alwaysOnTop: boolean;
  theme: 'light' | 'dark' | 'system';
  alertThresholds: number[]; // [80, 90, 100]
}
```

## Notes

- Need to parse Claude CLI `/usage` output format
- Guide re-login when session expires
- Settings stored in local JSON file
