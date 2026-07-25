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

## 2. Run the one-click guest demo

Install Node.js 22.13 or newer and Cloudflare's tunnel helper once:

```bash
brew install cloudflared
```

Then double-click `Start Remote REAPER Demo.command`. The launcher installs its
small Node dependency on first use, starts the relay, companion, and temporary
Cloudflare Quick Tunnel, and prints one complete Story Cue Studio guest link.
On macOS it also copies that link to the clipboard.

No `.env` file is required. Every launch creates a fresh 32-byte pairing secret,
random machine ID, and nonce in memory. It never reuses a permanent `.env`
pairing token. The guest link has this form:

```text
https://story-cue-studio.sruthin4444.chatgpt.site/#reaper-invite=<base64url JSON>
```

The secret is in the URL fragment after `#`, never in a query string. Browsers
do not send the fragment in the HTTP request to the hosted website. The launcher
constructs and copies the link locally; it does not upload the invite to Sites.
The fragment is still a bearer credential, so send the full link only to the
intended guest.

New guest connections and commands stop after about 50 minutes. The relay
enforces that deadline even if a browser ignores its local expiry. A command
accepted before the deadline can keep reporting progress, and status queries
from an already-connected browser remain available. At 90 minutes the launcher
hard-stops the tunnel, companion, and relay.

## 3. Manual local or hosted setup

The normal relay and companion commands remain available for development or a
long-lived hosted relay. They use `.env` as before:

```bash
cd remote-reaper
npm install
cp .env.example .env
```

For a same-computer protocol test, use two terminals:

```bash
npm run relay
```

```bash
npm run companion
```

Use `ws://127.0.0.1:8787` in a locally served Story Cue Studio page. The public
HTTPS website correctly requires a `wss://` address.

### Reach a manual companion from another network

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

## Paid voice protection

The one-click guest demo can receive `Build Immersive & Play`, but every exact
build request must be approved separately on the REAPER Mac. The macOS dialog
defaults to **Deny** and closes as denied after 45 seconds. Only clicking
**Approve This Build** allows that one request to reach the safety journal and
REAPER. Denial, timeout, a dialog error, or an unsupported platform all fail
closed without changing REAPER or using ElevenLabs credits. Replaying the same
request returns its recorded result instead of opening another dialog.
After a denial, timeout, or dialog failure, the launcher waits 25 seconds before
it will show another build-approval dialog, preventing remote prompt spam.

The launcher invokes `/usr/bin/osascript` directly, without a shell. The dialog
receives only a shortened request ID, target runtime, and sanitized episode
title—not the storyboard body, pairing secret, API key, or local paths. Approval
is never reusable, and there is no approval prompt when the demo starts.

In manual companion mode, remote `Build Immersive & Play` is refused unless the
Mac's `.env` contains:

```text
ALLOW_PAID_VOICE_GENERATION=true
```

Manual `.env` mode behaves as before and does not add the per-request macOS
dialog. The website also asks for confirmation before sending that command.

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
