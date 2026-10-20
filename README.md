# PC Remote — Windows host + customizable Android controller

A remote controller for your own Windows PC. The Windows server stays on your computer; a responsive phone browser interface **or** the native Android app can control it immediately, without a PIN, on your trusted private network.

> **Security:** Screen control and keyboard input are powerful. Use this only on your own PC and your trusted private Wi-Fi. The server is visible, has no unattended setup, and should **never** be exposed to the public internet. LAN traffic uses HTTP. For internet access use the Access-protected Cloudflare Tunnel configuration in [CLOUDFLARE.md](CLOUDFLARE.md); do not expose the origin port directly.

## What's included

- `start.bat`, `server.js`, `RemoteAgent/` — repaired Windows screen-sharing server and visible .NET desktop capture agent.
- `index.html` — responsive control UI with custom shortcut buttons (add / remove / remap / reorder), shortcut tray visibility, 3/4/5 columns, standard/large buttons and adjustable trackpad sensitivity (0.5–2.5x). Settings are saved locally on each phone using web storage.
- `android/` — Android app written in Kotlin. It opens a validated private-LAN PC IP and loads the same remote controller inside an Android WebView. It remembers only the PC IP and port; the PC connects automatically.
- `.github/workflows/android-apk.yml` — automatically creates an installable Android **debug APK** using GitHub Actions. It is available as a private workflow artifact, *not* a public Play Store release.
- `publish-private.bat` — creates the private GitHub repo and pushes files from your PC after you explicitly confirm.

## 1. Start your Windows server

1. Install [Node.js 20+](https://nodejs.org/) and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (already installed if the previous repair compiled).
2. Extract this updated project **into a new folder**. Close the old PC Remote terminal first to free port `7666`.
3. Double-click **`start.bat`**. Wait for the Windows desktop agent build to finish and read the printed `Phone URL` and connection status.
4. Allow Windows Firewall access for **private networks only**, if prompted.
5. To stop access, close the terminal. Do not disable antivirus or bypass Windows protections.

To change the port: in **Command Prompt**, run `set PORT=7777 && start.bat`. Your phone must use the same port.

## 2. Phone browser controller

Open the `Phone URL` in your phone browser on the same private Wi-Fi, then select **Remote screen**. Tap a text field on the Windows screen, then open **Keyboard**. **Live typing** is on by default: type into the phone panel and committed text appears on the PC automatically. You can use **Backspace** and **Enter** too. The panel now waits for the Windows agent to acknowledge commands and displays delivery errors. Acknowledgement cannot prove the target app used the text: Windows lock/UAC screens and some elevated applications reject input. Tap **⚙ Controls** to customize:

1. Assign a shortcut from the built-in safe list to any button.
2. Reorder buttons using ↑ and ↓, or remove and add buttons (up to 16).
3. Change the number of columns (3–5), button height, and trackpad sensitivity (0.5–2.5×).
4. Toggle the shortcut panel with **Show keys / Hide keys**.

Your settings stay on that phone/browser. Changes affect shortcuts for that phone, **not** the PC's actual keyboard layout. All input still goes through local session routes.

## Keyboard troubleshooting

1. In Windows, open **Notepad** and click inside the document using the remote screen controls. (Text cannot be entered on the Windows lock screen, UAC prompts, or some elevated apps.)
2. On the phone, open **Remote screen → Keyboard**. A visible typing box should open and focus; if your Android keyboard does not appear automatically, tap the box.
3. Check **Live typing: on**, type `Hello from my phone`, and confirm it appears in Notepad without pressing Send. Backspace and phone autocorrect update the same typing segment.
4. If live typing pauses, check the PC text before resuming: delivery might have occurred before the reply was lost. Select the PC field again and tap **New field** to start a fresh phone typing segment. The previous draft stays visible until you deliberately reset it.
5. If the phone reports **Live typing connected** but Notepad stays empty, check that Notepad has focus and is not running as administrator. Send the error message and PC server console output when requesting help.

To apply the keyboard fix to an existing installation, **close the old PC Remote host**, extract the new ZIP into a fresh folder, and run `start.bat` there, or `start-cloudflare.bat` for the custom domain. This update changes the Windows agent, Node server, and browser controls together; replacing only `index.html` is not sufficient.

## 3. Create a new PRIVATE GitHub repo

This project is packaged for publishing, but GitHub won't receive it until you run the script below.

1. Install [Git](https://git-scm.com/) and [GitHub CLI](https://cli.github.com/) on Windows. If GitHub CLI is missing: `winget install --id GitHub.cli -e` in PowerShell, then open a new terminal.
2. Open PowerShell and run `gh auth login` once. Choose GitHub.com and the browser sign-in flow.
3. Double-click **`publish-private.bat`** inside the project directory, review the list of files, and type `YES`.
4. The new repository will be called **`pc-remote-android`**, private under your signed-in GitHub account. You can inspect it with `gh repo view pc-remote-android --web`.

**Never** upload `config.json`, credentials, logs, pairing PINs, built binaries, or your personal machine data. `.gitignore` excludes the common generated files. If your GitHub account already has a repo of the same name, choose another name in `publish-private.bat` rather than overwriting one.

## 4. Download and install the GitHub-built APK

1. In the *private* `pc-remote-android` GitHub repository, open **Actions** → **Build Android APK**.
2. Open the newest successful run. Under **Artifacts**, download **`PC-Remote-Android-APK`** (a ZIP containing `android-debug.apk`).
3. Extract the APK on your Android phone and tap it to install; Android may ask you to allow installation from that file-manager/browser source.
4. Open **PC Remote**, enter the PC's IP (for example `192.168.8.105`, but use the actual IP displayed by the host) and port `7666`, then connect. No PIN is required by default.
5. Tap **Remote screen** → **⚙ Controls** to personalize on-phone controls.

The Android client uses a normal WebView and loads HTML from your Windows host. **You must run the updated Windows host files for custom controls to appear in the APK.** It doesn't connect over the internet or use a third-party cloud relay.

**APK notes:** Builds from this workflow are *debug* builds and are signed with a GitHub runner's temporary debug keystore. A new build may require uninstalling the old debug APK before installing the next one (losing Android app data). For updateable/release APKs, configure a private signing keystore through GitHub Secrets and a separate release workflow. Do not commit a signing key or store credentials in source control. No APK binary is bundled with the source ZIP — the workflow builds it after the first push. GitHub Actions artifacts require GitHub access to the private repository.

## Developer instructions

- Run `npm test` in the project root to test automatic connections, optional PIN pairing, authorization, and server-side input validation (doesn't require Windows).
- Open the repository in Android Studio to build the APK locally, or install JDK 17 + Android SDK 35 + Gradle 8.10.2 and run `gradle :android:assembleDebug`.
- Android app uses JavaScript + DOM storage, HTTP access strictly to a manually entered private IPv4 host/port, and no extra Android device privileges (no accessibility, microphone, or remote app installation).
- `.NET 8` agent sources are in `RemoteAgent/`. The original issue (`CS0266` at `Program.cs:188`) is fixed in this version.

## Limitations

- Windows agent captures the **primary monitor** only; it does not bypass UAC prompts or the Windows lock screen.
- PC + phone must use the same trusted LAN; direct LAN mode requires the same network; [Cloudflare Tunnel mode](CLOUDFLARE.md) supports internet access.
- Android WebView streaming and keyboard behavior depend on the phone's version of Android System WebView; the APK and text injection still need a live Windows/Android test.
- The automated server tests pass, but GitHub-hosted APK build and real Android input/screen usability must be verified after repository creation.


## Live typing and paste

Restart the Windows host with `start.bat` (LAN) or `start-cloudflare.bat` (custom domain) after replacing the source so it rebuilds the desktop agent. No Android build is needed for the browser controller.

Select **Remote screen**, tap or click the destination PC text box, and open **Keyboard**. Live typing sends committed phone input automatically, including corrections and Backspace. It preserves the PC clipboard. Your phone keyboard may hold a composing word until it commits it; this avoids duplicate IME/autocorrect text. The input queue waits for acknowledgement before sending the next edit, so typing can show network delay over the internet.

The phone text box mirrors the segment you have typed since selecting a field. It does not read pre-existing PC text. Remote clicks and caret-changing shortcuts start a fresh segment; pending typing must finish first. The **Enter** button waits for prior text, sends Enter, then starts a fresh segment. Enter can submit a form in the target app. If you use the PC keyboard, move the caret locally, or change windows outside the controller, select the PC field and tap **New field** before continuing.

Closing the keyboard keeps the current draft. A disconnect, screen reconnection, tab suspension, or failed delivery pauses live typing and preserves the draft; edits are never replayed automatically. Check what reached the PC, reselect the destination, and tap **New field** to resume. This clears only the phone mirror. **New field** does not erase PC text.

To paste copied phone text, use **Paste from phone**, or long-press the phone text box and choose **Paste**. Live mode sends it automatically. If clipboard reading is unavailable on local HTTP, native long-press Paste still works. Ctrl+V in the shortcut tray pastes the PC clipboard.

For a compose-first workflow, turn **Live typing** off, prepare text locally, then tap **Paste into PC**. Manual paste replaces the PC clipboard. This is also a fallback for target apps whose emoji/combining-character deletion differs from phone grapheme handling. Unicode insertion, input ordering, corrections, IME handling, error recovery, and Enter are covered by automated tests, but the actual target Windows app and phone keyboard still require a device check.

Desktop mouse selection/dragging and scrolling are supported in addition to phone touch controls. Shortcut customization remains available under **Controls**.

Connections are automatic by default. Anyone able to reach the host on your trusted LAN can control it while the host is running. Keep the host on a trusted private network and close its terminal to stop access. To require a PIN again, add `"requirePin": true` to your local `config.json` and restart the host.


For the custom domain **remote.teamtrader.co.za**, follow [CLOUDFLARE.md](CLOUDFLARE.md) and run `start-cloudflare.bat`. Protect the hostname with Cloudflare Access before publishing its tunnel route.


## Install to phone

Open `https://remote.teamtrader.co.za` after Cloudflare sign-in and tap **Install to phone**. Supported Android browsers offer the native install prompt. On iPhone, open the site in Safari, tap Share, and choose Add to Home Screen. If no prompt is available, the button shows the browser steps. Installation is a web app shortcut with a standalone window; no Android APK build is required. The phone still needs internet access and the Windows host running. Screen frames, authenticated pages and API responses are never cached for offline use.

## Desktop and screen controls

On a PC browser, select **Remote screen**, click the remote PC picture, and type with your physical keyboard. Ordinary text, Backspace, Enter, navigation and common shortcuts use the ordered remote input queue. Input is captured only while the remote picture has keyboard focus; typing into settings, the phone text panel or another browser field stays local. For desktop IME/dead-key composition, use the visible Keyboard panel.

**HD** is available on phones and PCs. It uses the full monitor resolution, JPEG quality 85, and up to 15 frames per second. It is the initial choice for desktop browsers with a fine pointer and at least 900px width; phone browsers start at Med, and saved quality preferences take priority. Cycle the quality button to reduce bandwidth or CPU use on slower connections.

Use **Reconnect** to reopen a stalled stream. The status distinguishes Connecting, Waiting for screen, Live and Disconnected, and detects a stream with no decoded frames. Reconnect preserves the phone draft, pauses uncertain typing and releases remote mouse buttons; check the PC field and tap New field before resuming.

Use **Full screen** for a clean view containing only the remote PC image on phones and PCs. Toolbars, keyboard panels, shortcuts and other app widgets are hidden. Press **Escape** on a PC or **tap with three fingers** on a phone to restore the controls. Phones may also exit with their system Back gesture. On browsers without native fullscreen support, **Expand view** hides the app controls while browser bars remain. Zoom buttons enlarge the picture from 100% to 400%; the percentage resets it. At higher zoom, **Pan view** moves the local picture without clicking or scrolling the PC. Switch back to **Control PC** to operate the zoomed screen. Mouse/touch positions map to the displayed part of the PC image.
