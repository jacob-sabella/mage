# Deploying the web client (sockbowl.com Docker host)

Self-updating deploy modeled on `sockbowl-docker`: GitHub Actions builds + pushes
images to GHCR on every push to `master`, and the host's **watchtower** auto-rolls
out the new `:latest` — so you never manually manage what's released.

## Topology

Two containers, both `network_mode: host` (matching the sockbowl-docker pattern),
fronted by the host's existing external reverse proxy (TLS terminates there):

```
browser ── https://mage.sockbowl.com ──▶ external proxy ──▶ 127.0.0.1:8090  (mage-web gateway)
                                                                   │  mage.remote.Session
                                                                   ▼
                                                            127.0.0.1:17171 (mage-server, same 1.4.60 fork)
```

The gateway is a *client gateway* — it needs a **version-matched** XMage server
(this fork @ 1.4.60). Public servers reject it (version handshake), so the server
is co-deployed. If you already run a 1.4.60 server, drop `mage-server` and point
the connect "Local" preset at it instead.

## Images (built by CI → GHCR)

- `ghcr.io/jacob-sabella/mage-web` — gateway + bundled SPA (`Mage.Client.Web/Dockerfile`)
- `ghcr.io/jacob-sabella/mage-server` — version-matched server (`Mage.Server/Dockerfile`)

## Compose fragment (add to `sockbowl-docker/docker-compose.yml`)

See `docker-compose.fragment.yml` in this dir. It adds `mage-server` + `mage-web`
(profile `full`, host networking, GHCR `:latest`, shared `mage_db` volume) and the
volumes. **Reuse the existing watchtower** — append the two container names to its
`command:` list; do NOT add a second watchtower.

## Env (host `.env`)

```bash
MAGE_WEB_PORT=8090
MAGE_GITHUB_REPO=jacob-sabella/mage
# optional: fine-grained PAT with issues:write on the fork → enables in-app reports
MAGE_GITHUB_TOKEN=
# optional: host path to a card-art cache (~15GB) for real card images
# MAGE_IMAGE_DIR=/srv/xmage/images
```

## Go-live checklist (outward-facing — run once, with intent)

1. Merge the Dockerfiles + workflow to `master` → CI builds + pushes both images.
   *(First `mage-server` build is long — it compiles Mage.Sets.)*
2. Make the GHCR packages pullable by the host: set them **public**, or
   `docker login ghcr.io` on the host with a `read:packages` PAT.
3. On the host: add the compose fragment + `.env`, then
   `docker compose --profile full up -d mage-server mage-web` and re-up watchtower
   so it picks up the extended `command:`.
4. DNS: `mage.sockbowl.com` → host IP.
5. Reverse proxy for that subdomain → `127.0.0.1:8090`, **WebSocket upgrade on**
   (the `/ws` endpoint) with a long read timeout (long-lived game sockets).
6. (optional) set `MAGE_GITHUB_TOKEN`, mount a card-art volume.

After step 1 is set up once, every merge to `master` rebuilds and watchtower rolls
it out automatically.

## Notes / caveats

- Card *search & deck-build* need `db/cards.h2.mv.db`; the co-deployed server
  generates it on first boot into the shared `mage_db` volume (search is empty
  until then; gameplay works regardless).
- Both images **must** run JDK 17 with the full `--add-opens` set (baked into the
  ENTRYPOINTs) or JBoss login fails immediately.
- `mage-server-1.4.60.jar` in the server ENTRYPOINT is version-pinned to the
  parent POM `<version>`; bump it if the project version changes.
