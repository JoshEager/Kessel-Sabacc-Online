# Kessel Sabacc Online

A multiplayer web version of **Kessel Sabacc**, the card game from *Star Wars Outlaws* — Sand and Blood decks, Impostors and Sylops, plus optional random shift tokens. Players meet in private rooms, and AI bots can fill empty seats.

This is an unofficial fan project. All card art, symbols and UI are original CSS/SVG; no Star Wars logos, fonts or game assets are used.

## Features

- Private rooms with a short code and a share link (`/?r=CODE`), 2–4 seats
- The host sets starting chips (4/6/8/10), the turn timer (15–90s, default 30s) and shift tokens (off, or 1–3 random per player), adds or removes Easy/Normal bots, and starts the game
- All 16 shift tokens from the game, with targeting, a banner for active rule changes, and bots that use them
- An authoritative server: all shuffling, dealing, dice and rule checks happen on the server, and clients never receive hidden cards or deck order
- Reconnects after a refresh (the session token is kept in `localStorage`); a disconnected or timed-out player automatically stands
- Timed Impostor dice choices (the best value is picked automatically on timeout), a round summary, a game log, chat, rematch and back-to-lobby
- Animated dealing, draws, discards, dice and reveal flips; optional synthesized sound effects (muted by default)
- A collapsible rules panel and a responsive layout that works on a phone in portrait mode

## Project layout

```
shared/   Pure, deterministic rules engine (RNG injected), view filtering, bot AI, protocol types
  src/      cards.ts · rng.ts · evaluate.ts · tokens.ts · engine.ts · view.ts · bot.ts · protocol.ts
  test/     Vitest unit tests
server/   Node + Express + Socket.IO; rooms kept in memory
  src/      app.ts (sockets/HTTP) · room.ts (room + timers + bots) · index.ts (entry)
  test/     Integration tests (full 4-bot game, socket flow)
client/   React + Vite UI (renders server state only)
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

## Deployment

It's a single stateful service. Rooms live in memory, so run **one instance**. WebSockets must be allowed (all three hosts below support them).

**Render** (Web Service)
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`. Render provides `PORT` automatically.

**Railway**
- Create a service from the repo. Railway detects Node.
- Build: `npm ci --include=dev && npm run build` · Start: `npm start`

**Fly.io**: use a minimal `Dockerfile` such as:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
```

Then run `fly launch` (set the internal port to 8080) and `fly deploy`. Keep `min_machines_running = 1` and a single machine, since game state lives in memory.

Restarting the server ends any games in progress.

## Rules summary

- Two 22-card decks, **Sand** and **Blood**: 3× each of 1–6, 3 Impostors and 1 Sylop.
- Each round, the decks are rebuilt and reshuffled, and each player is dealt 1 Sand + 1 Blood face down. One card of each suit is flipped to start the discard piles.
- Each player gets 3 turns, starting left of the dealer. On a turn you either **Stand**, or **Draw** for 1 chip (into your invested pile) from either deck or the top of either discard pile, then discard one card of that suit.
- At the reveal, each Impostor rolls two dice and its owner picks one. A Sylop copies the other card's value.
- Ranking: Pure Sabacc (two Sylops) > Prime Sabacc (pair of 1s) > other pairs (lower is better) > no pair (lower difference, then lower sum). Exact ties share the win.
- Optional shift tokens: the host sets 0–3 random tokens per player. Play one per turn, before acting, to tax opponents, refund chips, swap hands or change the round's rules. The full list is in the in-game Rules panel.
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

### Shift tokens

The token list and effect text follow the *Star Wars Outlaws* tokens (16 in total). The game doesn't spell out every detail, so these are the choices made here:

13. **Dealing:** when enabled, each player gets 1–3 random tokens at the start of the game, with no duplicates in one player's set (two players can hold the same token). Each token is single use for the whole game, and a rematch deals new ones. The setting is **off by default**.
14. **Timing:** you can play **one token per turn**, before you stand or draw. Playing a token doesn't use up your turn.
15. **Privacy:** your tokens are hidden from other players, but they see how many you have left. Every token play is public and logged.
16. **Where taxed chips go:** Tariffs and Audits move chips from the taxed player's stack into **their own pot**. They lose those chips if they lose the round and get them back if they win. A player who can't pay the full amount pays what they have.
17. **Refund / Extra Refund** move up to 2 / 3 chips from your pot back to your stack, and can only be played when your pot isn't empty. **Embezzlement** takes 1 chip from each other player's pot (if they have one) and puts it in yours.
18. **"In stand"** (the Audits) means the player's most recent action this round was to stand.
19. **Embargo** applies to whoever takes the next turn this round, and only for that turn. It can't be played on the round's last turn. An embargoed player may still play a token.
20. **Immunity** lasts until the reveal. It blocks taxes, Embezzlement, Embargo and being targeted, but not rule changes.
21. **Rule changes last until the reveal:**
    - **Major Fraud** makes every Impostor worth 6 with no dice roll, and a Sylop paired with it copies 6.
    - **Markdown** makes a lone Sylop worth 0. Two Sylops are still Pure Sabacc.
    - **Cook the Books** reverses the order of the pairs (6s best, 1s worst). Pure Sabacc stays on top, and playing it a second time flips the order back.
    - **Prime Sabacc** rolls two dice on the server and the player picks one. A pair of that value becomes the best Sabacc, below only Pure Sabacc, and takes the Prime Sabacc label. If the timer runs out, the server picks the die that helps your hand most and then you stand.
22. **Exhaustion** sends the target's hand to the discard piles and deals them a new one from the decks, which only they see. **Direct Transaction** swaps your hand with the target's.
