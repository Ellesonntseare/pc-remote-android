# Internet access at remote.teamtrader.co.za

Run the Windows host and Cloudflare Tunnel on the same Windows PC. No router port forwarding is needed. No Android build is required. The PC must stay awake, unlocked, and connected to the internet.

## Protect the hostname first

In Cloudflare Zero Trust, create a self-hosted Access application for `remote.teamtrader.co.za`, covering all paths. Add an Allow policy for your specific email address and enable your chosen login method (email one-time PIN is an option). Do not add Everyone, Bypass, or a public path exception. This replaces the app PIN with Cloudflare sign-in; an existing Cloudflare session normally avoids repeated prompts.

The app does not verify Cloudflare Access tokens itself. Cloudflare Access must protect this hostname before publishing the tunnel route. Enable the connector's **Protect with Access** option for this route and select the matching Access application/team and audience if offered, so cloudflared also validates the Access token. Keep the origin bound to loopback as configured below.

## Configure the Windows host

1. Close the old PC Remote terminal.
2. Copy `config.cloudflare.example.json` to `config.json` in this folder. If you already have `config.json`, merge the `tunnelHostname` setting into it and keep your other preferences.
3. Run `start.bat`. It rebuilds the Windows agent and starts the server on `127.0.0.1:7666` with `remote.teamtrader.co.za` as the only accepted hostname. The app uses no pairing PIN with this configuration.

The direct LAN IP URL will no longer work in tunnel mode. To return to LAN use, remove `tunnelHostname` and restart the host.

## Create the Cloudflare Tunnel

In Cloudflare's tunnel dashboard, create a Cloudflared tunnel and follow the Windows connector installation instructions on the Windows PC. Treat its installation token as a secret; do not share it in chat or commit it.

Add a published application route:

| Setting | Value |
| --- | --- |
| Public hostname | `remote.teamtrader.co.za` |
| Service type | HTTP |
| Origin service | `127.0.0.1:7666` |
| HTTP Host Header | `remote.teamtrader.co.za` |
| Protect with Access | Enabled for the Access application above |

Use HTTP only for the local connector-to-app hop. Open the public hostname with HTTPS. Leave TLS verification enabled. Cloudflare must control the domain's DNS, and any conflicting DNS record for this hostname must be resolved in your Cloudflare account.

Keep the PC Remote terminal running. The cloudflared connector must also be running; installing it as a Windows service does not start the PC Remote application for you.

## Verify before use

1. In a private browser window, open `https://remote.teamtrader.co.za/api/ping`. You must see Cloudflare sign-in before receiving app JSON. An unauthorized email must be denied. If JSON appears without a valid Access session, stop the tunnel and fix the Access application/policy.
2. Sign in with the allowed email, open `https://remote.teamtrader.co.za`, and confirm the app connects automatically without its own PIN.
3. Open Remote screen, select a Notepad text field on the PC, open Keyboard, type `hello`, and tap Paste into PC. Confirm `hello` appears in order. Repeat with copied text, emoji, and multiple lines.
4. Confirm closing the PC Remote terminal stops remote control.

Remote screen streaming and actual Windows paste over Cloudflare have not been validated by the cloud tests. Cloudflare session expiry and network interruption may require signing in or reopening Remote screen. Sending text replaces the PC clipboard; clipboard access on the phone still depends on browser permissions.
