# MockMate

APIs go down. You keep going.

MockMate is a Manifest V3 Chrome extension to record and replay API responses for any web app. It supports:

- Real / Record / Replay modes per origin
- Per-endpoint mock toggles
- In-popup response editing (status, headers, body)
- Global replay delay per origin (0 to 60000 ms)

## Install (Local)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:/Chrome Extension Projects/Rebound`

## Usage

1. Open your app tab.
2. Open MockMate popup.
3. Set mode:
   - **Record**: captures JSON and text API responses.
   - **Replay**: returns saved responses (if enabled).
   - **Real**: bypasses mocking.
4. Use **Mocked APIs** list to toggle endpoints ON/OFF.
5. Click endpoint to edit status/headers/body.
6. Set parent/global delay from `0` to `60000` ms.

## Notes

- Snapshots are isolated by origin.
- JSON and text responses are supported during recording.
- Data is stored only in `chrome.storage.local`.

## Publish to Chrome Web Store

1. Create a production ZIP:
   - Keep only extension files (exclude `.git`, local logs, temp files).
   - From `D:/Chrome Extension Projects/Rebound`, zip the folder contents.
2. Prepare listing assets:
   - Extension icon: `128x128` (already in `icons/icon128.svg`; export PNG for store upload if needed).
   - Screenshots: at least one desktop screenshot (`1280x800` or `640x400` recommended).
   - Optional promo tiles: small (`440x280`), large (`920x680`), marquee (`1400x560`).
3. Prepare compliance docs:
   - Privacy Policy URL (required for broad host access and network interception use-cases). A template is included in `PRIVACY_POLICY.md`.
   - Single-purpose description and clear permission justification.
4. Publish flow:
   - Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
   - Pay one-time developer registration fee (if not already done).
   - Click **New item** and upload ZIP.
   - Fill listing metadata (name, summary, description, category, language).
   - Complete Privacy tab + Data usage disclosures.
   - Submit for review.
5. After approval:
   - Set visibility (Public/Unlisted).
   - For updates, bump `version` in `manifest.json` and upload a new ZIP.

## Chrome Web Store Disclosure Notes

Use these points when completing the Chrome Web Store Privacy/Data disclosure form:

- Data is stored locally in `chrome.storage.local`.
- Extension purpose: developer API mocking (record/edit/replay responses).
- Captured data can include request URL/method and response status/headers/body.
- No sale of user data.
- No transfer of captured payloads to extension-owned external servers.
