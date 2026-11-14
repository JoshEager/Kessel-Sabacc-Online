# Kessel Sabacc Online

A multiplayer web version of **Kessel Sabacc**, the card game from *Star Wars Outlaws* — Sand and Blood decks, Impostors and Sylops, plus optional random shift tokens and cheats. Players meet at public or private tables of 2–8, and AI bots can fill empty seats.

This is an unofficial fan project. All card art, symbols and UI are original CSS/SVG; no Star Wars logos, fonts or game assets are used.

## Features

- Public tables listed in a live browser that anyone can join, and private rooms that need the code or share link (`/?r=CODE`); tables of 2–8 players
- The host sets visibility (public or private), table size (2–8), cheats (off or on), starting chips (4/6/8/10), the turn timer (15–90s, default 30s) and shift tokens (off, or 1–3 random per player), adds or removes Easy/Normal bots, and starts the game
- All 16 shift tokens from the game, with targeting, a banner for active rule changes, and bots that use them
- Optional cheats modelled on the game's three: Peek, Double Draw and Magnetic Dice, with a chance of getting caught
- An authoritative server: all shuffling, dealing, dice and rule checks happen on the server, and clients never receive hidden cards or deck order
- Reconnects after a refresh (the session token is kept in `localStorage`); a disconnected or timed-out player automatically stands
- Timed Impostor dice choices (the best value is picked automatically on timeout), a round summary, a game log, chat, rematch and back-to-lobby
- Animated dealing, draws, discards, dice and reveal flips; optional synthesized sound effects (muted by default)
- A collapsible rules panel and a responsive layout that works on a phone in portrait mode
- Installable as an app (PWA) on iPhone, Android and desktop, with no app store involved

## Project layout

```
shared/   Pure, deterministic rules engine (RNG injected), view filtering, bot AI, protocol types
  src/      cards.ts · rng.ts · evaluate.ts · tokens.ts · engine.ts · view.ts · bot.ts · protocol.ts
  test/     Vitest unit tests
server/   Node + Express + Socket.IO; rooms kept in memory
  src/      app.ts (sockets/HTTP) · room.ts (room + timers + bots) · index.ts (entry)
  test/     Integration tests (full 4-bot game, socket flow)
client/   React + Vite UI (renders server state only)
  public/   PWA manifest, service worker (sw.js) and icons
scripts/  generate-icons.mjs (redraws the PNG app icons: npm run icons)
```

The engine never mutates its input. `applyAction(state, playerId, action, rng)` returns a new state or throws `IllegalMoveError`, and `toGameView(state, viewerId)` removes everything that seat may not see. Bots decide from that same filtered view.

## Local development

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

This runs the API/socket server on `http://localhost:3001` and Vite on `http://localhost:5173` (which proxies `/socket.io`). Open http://localhost:5173.

Both servers listen on `0.0.0.0`, so other devices on your LAN or tailnet can join at `http://<your-ip>:5173` (Vite prints the Network URLs). Any hostname works, including Tailscale MagicDNS short names like `http://server:5173`. Set `HOST=127.0.0.1` to keep the API server local-only. On Windows, allow Node through the firewall when prompted.

Other scripts:

```bash
npm test            # Vitest: rules engine unit tests + server integration tests
```

```bash
npm run typecheck   # tsc --noEmit across shared, server and client
```

```bash
npm run build && npm start   # production build, served from one process on $PORT (default 3001)
```

`npm run build` outputs `dist/public` (the client) and `dist/server.js` (the bundled server). One Node process serves both, plus a health check at `/healthz`.

## Deployment (Docker)

The repo includes a `Dockerfile` and `docker-compose.yml`. On any machine with Docker:

```bash
docker compose up -d --build
```

The game is then at `http://<host>:3001`. To use a different port, copy `.env.example` to `.env` and set `APP_PORT`. The container restarts automatically and has a health check on `/healthz`. To update after pulling new code, run the same command again.

```bash
docker compose logs -f   # follow the server log
```

```bash
docker compose down      # stop it
```

It's a single stateful service: rooms live in memory, so run **one instance**, and restarting ends any games in progress.

### HTTPS (needed to install the app)

Phones only offer to install a PWA from an **HTTPS** site (plain `http://localhost` also works, for testing on the same machine). Pick one:

- **Tailscale sidecar (nothing installed on the host, no ports to open):** the `tailscale` profile starts a Tailscale container next to the game. It joins your tailnet as its own machine and serves the game over HTTPS. By default it is also public on the internet through Tailscale Funnel. Steps:
  1. In the Tailscale admin console, turn on MagicDNS and HTTPS certificates, and allow Funnel for the node (the `funnel` node attribute in the tailnet policy file; the admin console offers to add it).
  2. Create an auth key and set `TS_AUTHKEY=tskey-auth-...` in `.env`. You can also leave it empty and open the login URL from `docker compose logs tailscale`.
  3. Start it:

     ```bash
     docker compose --profile tailscale up -d --build
     ```

  The game is then at `https://sabacc.<tailnet>.ts.net` (change the name with `TS_HOSTNAME`). The node identity is kept in a Docker volume, so the key is only needed the first time. To keep it private to your tailnet instead, set `TS_SERVE_CONFIG_FILE=serve.json`. The serve configs are in `tailscale/`. Optionally set `APP_PORT=127.0.0.1:3001` so the game is only reachable through Tailscale.

- **Tailscale on the host:** if the Docker host already runs Tailscale, enable HTTPS certificates for the tailnet and run the command below. The game is then at `https://<machine>.<tailnet>.ts.net`.

  ```bash
  tailscale serve --bg 3001
  ```

- **Public domain with the bundled Caddy proxy:** point a DNS record at the server, open ports 80 and 443, set `DOMAIN=sabacc.example.com` in `.env`, and start it with the command below. Caddy gets and renews a Let's Encrypt certificate automatically.

  ```bash
  docker compose --profile https up -d --build
  ```

- **Anything else you already run** (Cloudflare Tunnel, nginx, Traefik) works too. Proxy to port 3001 and allow WebSockets.

### Installing on a phone

- **Android (Chrome, Edge, Samsung Internet):** open the site and tap **Install app** on the home screen, or use the browser menu's *Install app* / *Add to Home screen*.
- **iPhone / iPad (Safari):** tap **Share**, then **Add to Home Screen**. The home screen shows this hint in Safari.
- **Desktop Chrome/Edge:** use the install icon in the address bar.

The installed app opens fullscreen with its own icon. It still needs the server to play, and updates arrive automatically whenever you redeploy.

### Without Docker

Any Node 20+ host works. Build with `npm ci --include=dev && npm run build`, start with `npm start`, and use `/healthz` as the health check. `PORT` is read from the environment, so this works on Render, Railway, Fly.io and similar hosts (the `Dockerfile` also works on Fly.io as-is). Keep a single instance.

## Rules summary

- Two 22-card decks, **Sand** and **Blood**: 3× each of 1–6, 3 Impostors and 1 Sylop.
- Each round, the decks are rebuilt and reshuffled, and each player is dealt 1 Sand + 1 Blood face down. One card of each suit is flipped to start the discard piles.
- Each player gets 3 turns, starting left of the dealer. On a turn you either **Stand**, or **Draw** for 1 chip (into your invested pile) from either deck or the top of either discard pile, then discard one card of that suit.
- At the reveal, each Impostor rolls two dice and its owner picks one. A Sylop copies the other card's value.
- Ranking: Pure Sabacc (two Sylops) > Prime Sabacc (pair of 1s) > other pairs (lower is better) > no pair (lower difference, then lower sum). Exact ties share the win.
- Optional shift tokens: the host sets 0–3 random tokens per player. Play one per turn, before acting, to tax opponents, refund chips, swap hands or change the round's rules. The full list is in the in-game Rules panel.
- Optional cheats: Peek at an opponent's hand, Double Draw (keep the best of three), or nudge an Impostor die with Magnetic Dice. Each attempt has a 25% chance of getting caught, which is announced and fined.
- Winners take back what they invested. Losers lose what they invested and also pay a penalty: 1 chip with a Sabacc, otherwise their difference (capped at what they have). A player with 0 chips is out, and the last player with chips wins.

## Rule interpretations

These are the cases the brief left open, and how this version handles them:

1. **Clockwise = increasing seat order.** The dealer for round 1 is chosen at random. After that the dealer button moves to the next seat that still has chips, skipping eliminated players.
2. **Drawing from a discard pile, then discarding that same card** is allowed. It costs the chip and changes nothing else.
3. **Visible discards:** every discard is public, so the full face-up discard piles are part of each player's view. The UI shows the top card and the count, and Normal bots use the whole pile when counting cards.
4. **Impostor timeout:** if time runs out, the engine picks the dice that give the best hand. With two Impostors it picks both values together, not one die at a time.
5. **A Sylop paired with a 1-valued Impostor** makes Prime Sabacc, the same as a Sylop with a natural 1.
6. **Ties:** all hands tied for best are winners and each takes back their own investment. Ranking places are shared (for example #1, #1, #3).
7. **Penalties:** a loser always loses their invested chips. The penalty is then capped at their remaining stack. Invested chips leave the game; they don't go to the winner.
8. **Deck exhaustion:** when a deck is empty at draw time, its discard pile minus the top card is shuffled into a new deck. If there is nothing to rebuild with, drawing from that deck is illegal.
9. **Disconnects and timeouts:** on your turn you auto-stand. If you already drew, the drawn card is discarded and you keep your hand. A disconnected player acts automatically after a short grace period, so the table never stalls.
10. **Leaving:** leaving in the lobby frees the seat. Leaving mid-game keeps the seat on autopilot (always standing) and it can't be reclaimed. Players who left are dropped on rematch.
11. **Between rounds:** the summary stays up until every connected player still in the game presses Next round, or 15 seconds pass.
12. **Host handoff:** if the host disconnects, the next connected human becomes host.
13. **Public tables:** the public list shows public rooms that have at least one connected player. Lobbies with an open seat come first and can be joined; full lobbies and games in progress are listed but can't be joined, since players can't join mid-game. The host can switch a room between public and private any time in the lobby. Invite links (`/?r=CODE`) work the same for both and show the table's host, seats and settings before you join.

### Shift tokens

The token list and effect text follow the *Star Wars Outlaws* tokens (16 in total). The game doesn't spell out every detail, so these are the choices made here:

14. **Dealing:** when enabled, each player gets 1–3 random tokens at the start of the game, with no duplicates in one player's set (two players can hold the same token). Each token is single use for the whole game, and a rematch deals new ones. The setting is **off by default**.
15. **Timing:** you can play **one token per turn**, before you stand or draw. Playing a token doesn't use up your turn.
16. **Privacy:** your tokens are hidden from other players, but they see how many you have left. Every token play is public and logged.
17. **Where taxed chips go:** Tariffs and Audits move chips from the taxed player's stack into **their own pot**. They lose those chips if they lose the round and get them back if they win. A player who can't pay the full amount pays what they have.
18. **Refund / Extra Refund** move up to 2 / 3 chips from your pot back to your stack, and can only be played when your pot isn't empty. **Embezzlement** takes 1 chip from each other player's pot (if they have one) and puts it in yours.
19. **"In stand"** (the Audits) means the player's most recent action this round was to stand.
20. **Embargo** applies to whoever takes the next turn this round, and only for that turn. It can't be played on the round's last turn. An embargoed player may still play a token.
21. **Immunity** lasts until the reveal. It blocks taxes, Embezzlement, Embargo and being targeted, but not rule changes.
22. **Rule changes last until the reveal:**
    - **Major Fraud** makes every Impostor worth 6 with no dice roll, and a Sylop paired with it copies 6.
    - **Markdown** makes a lone Sylop worth 0. Two Sylops are still Pure Sabacc.
    - **Cook the Books** reverses the order of the pairs (6s best, 1s worst). Pure Sabacc stays on top, and playing it a second time flips the order back.
    - **Prime Sabacc** rolls two dice on the server and the player picks one. A pair of that value becomes the best Sabacc, below only Pure Sabacc, and takes the Prime Sabacc label. If the timer runs out, the server picks the die that helps your hand most and then you stand.
23. **Exhaustion** sends the target's hand to the discard piles and deals them a new one from the decks, which only they see. **Direct Transaction** swaps your hand with the target's.

### Cheats and larger tables

The *Star Wars Outlaws* version has three cheats (Nix Peek, Double Draw and Magnetic Dice) used against AI players, with a timing minigame and table bans. Guides only describe them loosely, so this multiplayer version works like this:

24. **Off by default.** The host turns cheats on for the whole table in the lobby. Bots never cheat.
25. **Getting caught:** every attempt has a flat **25% chance** of being caught. A caught cheat fails, is announced in the log, adds a "Caught ×N" badge to your seat, and fines you into your own pot: 1 chip the first time, 2 the second, and so on (capped at what you have). There are no table bans. A cheat that works leaves no trace in the log.
26. **Peek** (on your turn, before acting, once per turn): see one opponent's hand. It is a snapshot taken at that moment, shown face up only to you for the rest of the round. Immune players can't be peeked at.
27. **Double Draw** (instead of a normal deck draw, costs the usual chip): draw two cards from a deck, keep one of the three, discard one face up, and slip the spare back into the deck at a random position. Everyone else just sees a normal draw. If you're caught, it becomes a normal single draw plus the fine.
28. **Magnetic Dice** (at the reveal, once per Impostor): nudge one of your Impostor's dice up or down by 1 (staying within 1–6) before choosing. The dice are public, so a sharp-eyed opponent may notice a die change.
29. **Larger tables:** tables hold 2–8 players (4 by default). With more than 3 opponents, they're shown in a grid across the top of the table. The deck rules are unchanged: the 22-card decks are rebuilt from the discard piles when they run out.
