# Story Cue Studio Remote REAPER

This companion adds the different-network path shown in Story Cue Studio:

```text
Story Cue Studio website
        ↕ secure WebSocket
Public Node.js relay
        ↕ secure WebSocket
Node companion on the REAPER Mac
        ↕ localhost HTTP
REAPER Web Control and local ReaScripts
```

The relay routes allowlisted commands and progress only. It never receives the
ElevenLabs API key, arbitrary REAPER action IDs, shell commands, or raw access to
REAPER Web Control.

## 1. Prepare the REAPER target project

Do not use the master cue-bank project as the production target.

1. Open or save a separate storyboard project/template.
2. Stop playback and place the edit cursor where the episode should begin.
3. In **Actions → Show action list**, choose **ReaScript: Load…**, select
   `Enable Story Cue Studio Remote Target.lua` from this package, then run it.
4. Save the project again so its remote-target marker is retained.
5. Keep REAPER Web Control enabled on local port `8089`.

The companion refuses remote jobs if the active project is not explicitly marked
as a story target, if playback is running, or if the project changes during a job.

## Local safety journal

Before any remote REAPER action runs, the Mac companion atomically records a
small local checkpoint. It stores only the request ID, symbolic action, runtime,
timestamps, and SHA-256 storyboard digest—never story text, pairing tokens, API
keys, or other credentials.

On macOS the default file is:

```text
~/Library/Application Support/Story Cue Studio/remote-companion-journal.json
```

If the companion or REAPER job fails, or the companion restarts while a job was
marked running, remote readiness remains locked as `needs_attention`. First stop
the companion, inspect REAPER for a partial import, duplicated cue stack, voice
charge, or running playback, then clear the lock locally:

```bash
npm run journal:status
npm run clear-safety-lock
```

A successfully completed `Build Immersive & Play` digest cannot be submitted a
second time accidentally. To intentionally regenerate that exact completed
storyboard, stop and inspect the companion, then arm one one-shot local override:

```bash
npm run allow-repeat-build
```

The override is consumed by the next build request. It does not bypass a
`running` or `needs_attention` safety lock.

## 2. Install the Node package

Node.js 22.13 or newer is required.

```bash
cd remote-reaper
npm install
cp .env.example .env
```

In the website, choose **Internet Relay**, select **New token**, then select
**Download config**. A relay URL is not required yet for the temporary tunnel.
Move the downloaded `.env` into this folder.

## 3. Start locally

For a same-computer protocol test, use two terminals:

```bash
npm run relay
```

```bash
npm run companion
```

Use `ws://127.0.0.1:8787` in a locally served Story Cue Studio page. The public
HTTPS website correctly requires a `wss://` address.

## 4. Reach it from another network

Run `relay.mjs` on a single-instance Node host that supports persistent
WebSockets, then use its `wss://` address in the website. The host should run:

```bash
npm install
npm run relay
```

The Mac companion uses the same public `wss://` URL and makes only an outbound
connection. No router port forwarding is required.

For a temporary rehearsal, the local relay can instead be placed behind an
HTTPS tunnel that supports WebSockets. Temporary tunnel addresses change when
restarted and are not a production deployment.

### One-window rehearsal tunnel

The included `Start Remote REAPER Demo.command` starts:

- the local Node relay;
- the Mac companion;
- a temporary Cloudflare Quick Tunnel with a public `wss://` address.

Install `cloudflared` once with Homebrew, put the website-downloaded `.env` file
in this folder, then double-click the launcher. Paste the printed `wss://`
address into Story Cue Studio. The temporary address remains available only
while the launcher stays open.

## Paid voice protection

`Import Story`, `Recall Cues`, and `Generate Voices` do not start paid voice
generation. Remote `Build Immersive & Play` is refused unless the Mac's `.env`
contains:

```text
ALLOW_PAID_VOICE_GENERATION=true
```

The website also asks for confirmation before sending that command.

The journal is an additional local guard. Do not clear its lock or arm a repeat
override from a remote shell; these commands are intended to be deliberate
actions performed at the REAPER Mac after inspecting the session.

## Relay hosting health check

The relay exposes:

```text
GET /health
```

It reports only whether the service is running and how many companions are
online. It does not expose machine IDs, story text, tokens, or REAPER details.
