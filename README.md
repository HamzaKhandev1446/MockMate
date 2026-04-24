# MockMate

APIs go down. You keep going.

MockMate is a Manifest V3 Chrome extension to record, edit, and replay API responses for web app development and testing.

## Key Features

- Real / Record / Replay modes
- Per-endpoint mock toggles
- Editable status, headers, and body for saved mocks
- Global extension ON/OFF toggle
- Session workflow with Unsaved Draft -> Save Draft as Session
- Global replay delay control (0 to 60000 ms)

## Local Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Privacy

- Data is stored locally using `chrome.storage.local`.
- A publishable policy file is available at `privacy-policy.html`.

## Packaging

Build release ZIP with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

Output:

- `dist/mockmate-v<version>.zip`
