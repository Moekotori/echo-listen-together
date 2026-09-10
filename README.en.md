# ECHO Listen Together Server

[简体中文](README.md) | **English**

A self-hosted room service and real-time Opus relay for ECHO. The host shares one audio stream; listeners do not need their own copy of the song. The server does not decode, transcode, or store music files.

You need an **ECHO desktop client** that supports Listen Together. This repository contains the server, not a browser-based player.

## 1. Prerequisites

- A Linux server with Git, Docker Engine, and the Docker Compose plugin (`docker compose`). See the [official Docker installation guide](https://docs.docker.com/engine/install/).
- **No host Node.js or npm required.** The script uses Node inside Docker to generate configuration. Docker itself must already be installed.
- A public IPv4 address, or a domain pointing to it. For example, create an A record for `listen.example.com` pointing to your server.
- Allow inbound **TCP 80 and 443** in both your cloud security group and system firewall. These ports must be available. Do not expose the internal relay port 8787 publicly.
- Permission to run Docker. Run the commands below in the server terminal.

Check the prerequisites:

```sh
git --version
docker version
docker compose version
```

## 2. One-command deployment wizard (recommended)

```sh
git clone https://github.com/Moekotori/echo-listen-together.git
cd echo-listen-together
./deploy.sh
```

Enter your domain or public IPv4 address, such as `listen.example.com`, **without a scheme, port, or path**.

The wizard automatically:

1. Creates a `.env` file with mode `600` and a random administrator token.
2. Selects the domain or IP Compose configuration, builds the image, and starts the containers.
3. Uses Caddy to obtain and automatically renew a trusted HTTPS certificate.
4. Checks the public endpoint and prints the connection address, connection code, password guidance, capacity limits, and management commands.

The deployment script has bilingual prompts; the detailed information report currently uses Chinese. `公网健康检查：检查通过` means the public health check passed. A running container alone does not prove public connectivity. Initial certificate issuance may take time. If the check fails, troubleshoot below and rerun the information command rather than repeatedly deleting configuration and requesting certificates.

**A domain is optional.** For public IPv4 deployment, the wizard uses Caddy 2.11.4 through `compose.ip.yaml` and a short-lived Let's Encrypt IP certificate. Keep the gateway running, ports reachable, and certificate volumes persistent for automatic renewal. Do not bypass certificate validation.

If `.env` exists, the script reuses it and rebuilds/starts services without replacing credentials. Run during an idle period because restarts end temporary rooms. The legacy `npm run setup` remains available for hosts with Node installed.

## 3. Optional manual Docker deployment

Clone and enter the repository, then copy the template. Do not overwrite an existing `.env`:

```sh
cp -n .env.example .env
chmod 600 .env
```

Edit `.env`. For a domain, set at least:

```dotenv
COMPOSE_PROJECT_NAME=echo-listen
COMPOSE_FILE=compose.yaml
DOMAIN=listen.example.com
PUBLIC_URL=wss://listen.example.com
SERVER_NAME=My ECHO Server
```

For an IP-only deployment, use:

```dotenv
COMPOSE_FILE=compose.yaml:compose.ip.yaml
DOMAIN=YOUR_PUBLIC_IPV4
PUBLIC_URL=wss://YOUR_PUBLIC_IPV4
```

Generate a random administrator token with a password manager and replace the `ADMIN_TOKEN` placeholder in `.env`. `SERVER_PASSWORD` is an optional server access password. Leaving it empty allows anyone who knows the address to connect. Never share `.env` or put real credentials in screenshots, documentation, or Git.

```sh
docker compose up -d --build
docker compose ps
docker compose exec relay npm run info
```

The information command reads the running container's configuration and checks the public health endpoint with a 5-second timeout and TLS validation enabled. Failure produces a nonzero exit code. Success confirms reachability from the machine running the check.

## 4. Listen together in ECHO

1. Open **Listen Together** (`一起听歌`) in ECHO.
2. Paste the deployment report's `wss://…` address or `echo-listen:…` connection code into the server address/code field.
3. Enter a nickname. Leave the server password blank if the administrator has not set one.
4. Connect and create a room with a name, optional password, and member limit. Hidden rooms do not appear in the public list.
5. The host plays a local PCM track through the native audio engine, then enables **audio sharing**. Remote sources and DSD passthrough are currently unsupported for sharing.
6. Friends connect to the same server and select a public room, enter a room ID, or use an invitation code. They do not need the music file. Joining pauses personal playback while keeping the queue.
7. Listeners control their own listening volume. Stopping sharing does not stop the host's local playback. Ending the room removes its members.

Room invitation codes expire after **5 minutes**, can be used **once**, and can be revoked by the host. They are different from deployment connection codes, which contain only the server address. Ask the host to generate a new invitation if one expires.

Steam invitations require a compatible ECHO client launched through Steam with working Steam integration. Deploying this server does not configure Steamworks. Publishing rich-presence text and testing invitations with two Steam accounts are separate steps. Use connection codes when Steam invitations are unavailable.

## 5. Configuration

After editing `.env`, run `docker compose up -d` to recreate affected containers. `restart` alone does not load changed environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOMAIN` | `listen.example.com` in template | Public domain or IPv4 for Caddy, without a scheme |
| `PUBLIC_URL` | `wss://listen.example.com` in template | Public client address matching the certificate |
| `SERVER_NAME` | `ECHO Listening Room` in template | Display name in ECHO |
| `MAX_USERS` | `200` | Total users, including lobby users, hosts, and briefly disconnected sessions |
| `MAX_ROOMS` | `30` | Maximum concurrent rooms |
| `MAX_ROOM_USERS` | `10` | Maximum room members, including the host |
| `RECONNECT_SECONDS` | `60` | Session retention after a short disconnect |
| `EMPTY_ROOM_SECONDS` | `60` | Cleanup delay with nobody online; retained members keep their reconnect grace. Reconnection cancels expiry. An online host alone or paused is not an empty room. Explicit host departure or expiry of the host reconnect window still ends the room as before |
| `SERVER_PASSWORD` | Empty | Optional server access password, separate from room passwords |
| `ADMIN_TOKEN` | Randomly generated by wizard | Administrator credential, not a client connection password |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | Internal container listener; normally leave unchanged |

Administrators can query `/admin/status` with an `Authorization: Bearer …` header for user, room, and connection counts. Keep the token out of URLs. `/health` requires no authentication.

## 6. Operations and updates

Run these commands from the deployment directory:

```sh
# Connection information and public health check
docker compose exec relay npm run info
# Container status and recent logs
docker compose ps
docker compose logs --tail=80 relay gateway
# Update the server
git pull --ff-only
docker compose up -d --build
# Stop / resume services
docker compose stop
docker compose start
```

**Restarting the relay clears temporary rooms and invitations held in memory.** Users must reconnect and recreate rooms. Schedule updates during an idle period. Do not run `docker compose down -v`: it deletes certificate volumes. Preserve `.env`, `caddy_data`, and `caddy_config`, and protect credentials in backups.

## 7. Troubleshooting

| Symptom | What to check |
| --- | --- |
| `docker compose` is unavailable | Install the Compose plugin; ensure Docker is running and your account can access it |
| Ports 80/443 are occupied | Check existing websites or reverse proxies. Do not stop unrelated services. This guide assumes Caddy owns those ports |
| Containers start but the public check fails | Verify DNS A records, public IP, security group, firewall, and `docker compose logs --tail=80 gateway`; correct invalid AAAA records too |
| Certificate error | Check address/certificate match, system time, port reachability, and Caddy logs; preserve volumes and keep TLS validation enabled |
| Root URL returns 404 in a browser | Expected: there is no web player. Use `/health` for health checks and ECHO for listening |
| Incorrect password | Distinguish server password, room password, and administrator token; the token cannot join a room |
| Missing room or expired invitation | Confirm the same server is selected; use an ID/invitation for hidden rooms; ask for a new single-use invitation |
| Joined but no audio | Host must play a supported local PCM track and enable sharing; check listener volume/output device and retry the audio connection if needed |
| Cross-region stuttering | Check latency, packet loss, and congestion on the actual route; advertised bandwidth does not guarantee peak-hour connectivity |

## 8. Verification and capacity limits

Development and remote checks require Node.js 22+:

```sh
npm ci
npm test
# Your own deployed server: creates and cleans up one temporary private room
node scripts/smoke-remote.mjs wss://listen.example.com
# Short local synthetic relay check; does not connect to production
node scripts/smoke-capacity.mjs
```

For a password-protected server, securely provide `SERVER_PASSWORD` through the environment, never in arguments or URLs. Tests use synthetic data and do not require private songs.

Real WebSocket tests cover permissions, capacity, concurrent password joins, reconnect takeover, room notifications, and audio relay. The 200-client script runs **20 rooms with 1 host and 9 listeners each for about 2 seconds**, checking 18,000 relayed packets. Its process contains both server and test clients; the memory figure is not a standalone server benchmark. It does not establish long-running or public-network capacity.

Default audio uses 48 kHz stereo Opus in 20 ms packets. At 128 kbps, 200 listener streams require approximately 25.6 Mbps of audio payload, plus protocol overhead and headroom. New audio is dropped when a receiver has more than 16 KiB queued; ten seconds of sustained congestion closes that connection to avoid unbounded buffering. TLS WebSocket uses TCP, so packet loss can disrupt real-time delivery. Carrier routes, peak hours, sustained load, and two-account Steam behavior require separate validation.

See the [2026-09-10 synchronization record](docs/verification-2026-09-10.md) for the current server checks, and the [2026-09-09 verification record](docs/verification-2026-09-09.md) for earlier native audio and reconnect results. Both describe their validation boundaries.

## Privacy and development

The explicitly selected server receives nicknames, room information, audio after sharing is enabled, and current-programme tags, bounded artwork thumbnails, lyrics and media clocks supplied by compatible clients. Chat and typing presence are relayed only to room members. The entire library, file paths and playback history are not uploaded. Current-programme data remains in memory, without audio or metadata history. Server operators can access data passing through their server. Room passwords use salted scrypt and remain in memory; invitations and logs are bounded. The service does not record audio, passwords, or invitations and does not enable access logs. Share only content you have the right to transmit.

Local development: `npm ci && npm start`, then connect to `ws://localhost:8787`. Use `wss://` on public networks. See [PROTOCOL.md](PROTOCOL.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Public source visibility does not automatically grant redistribution rights; the project license is determined by the maintainer.

## Server diagnostic reports

The relay records connection closure reasons, first-packet timeouts, audio stalls/recovery, and validation/rate-limit/congestion counters. It does not log audio, chat bodies, passwords or invitations. To generate a report, run from the server project directory (host Python 3 is needed only for this optional tool):

```sh
python3 scripts/listening-server-report/collect.py --hours 6
```

Markdown and JSON reports are written to `misc/diagnostic-reports/`, retaining the latest ten pairs. They include container state, source hashes, per-connection counters and event timelines. Collection does not restart the service. Cumulative snapshots are not added together, and a submitted WebSocket send is not proof of audible client playback. See the [report tool documentation](scripts/listening-server-report/README.md).
