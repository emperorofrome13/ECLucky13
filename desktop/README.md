# ECLucky13 desktop shell (Electron)

Native window + tray + server lifecycle, the same shape as opencode desktop
(Electron wrapping a local server + web UI).

## Run from source (this repo)

```bat
cd desktop
npm install
npm start
```

Starts the repo server on port 3313 (or `%EC13_PORT%`) with data in
`%APPDATA%\ECLucky13\data` and opens the app window. Closing the window hides
it to the tray; Quit from the tray stops the server.

## Build the Windows installer

```bat
cd desktop
npm install
npm run package
```

Produces `dist\ECLucky13-Setup-1.0.26.exe` (per-user NSIS, no admin needed).
First launch copies the app into `%LOCALAPPDATA%\ECLucky13\app`, runs
`npm install --omit=dev` + `npm run build` in a progress window (needs
Node 20+ and internet once), then starts normally. Tray menu: Open window,
Restart server, Open data folder, Start with Windows, Quit.

Version is pinned in `desktop/package.json` — bump it with the app version.
