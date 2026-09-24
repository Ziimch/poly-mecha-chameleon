# Poly Mecha Chameleon FPS — V2/V3 Guest Edition

Frontend: GitHub Pages. Multiplayer backend: Cloudflare Workers + Durable Objects.

## Guest mode
No account is required. A player enters a nickname and presses PLAY AS GUEST.
The nickname is saved locally in the browser. There is no login flow.

## Included
V2:
- body-part damage model (server data for head/body/arms/legs)
- head/body hit result
- ragdoll-style death/respawn event foundation
- rifle ammo/reload
- grenade
- ability button
- kill feed
- scoreboard
- room selection
- team/FFA/survival mode selection
- mobile HUD

V3 foundation:
- matchmaking-ready room routing
- multiple maps: arena/training client map foundation
- game mode selection
- skin field and color/team representation
- inventory/weapon state foundation
- guest identity without account
- persistent server statistics table foundation

Important: this is a playable prototype, not a production anti-cheat/authentication system. Persistent statistics are prepared in Durable Object SQLite, while guest sessions remain account-free.
