# PC Remote — Windows host + customizable Android controller

A **LAN-only** remote controller for your own Windows PC. The Windows server stays on your computer; a responsive phone browser interface **or** the native Android app can control it after entering the server's temporary 8-digit pairing PIN.

> **Security:** Screen control and keyboard input are powerful. Use this only on your own PC and your trusted private Wi-Fi. The server is visible, has no unattended setup, and should **never** be exposed to the public internet. Traffic is local HTTP, **not end-to-end encrypted**.

## What's included

- `start.bat`, `server.js`, `RemoteAgent/` — repaired Windows screen-sharing server and visible .NET desktop capture agent.
- `index.html` — responsive control UI with custom shortcut buttons (add / remove / remap / reorder), shortcut tray visibility, 3/4/5 columns, standard/large buttons and adjustable trackpad sensitivity (0.5–2.5x). Settings are saved locally on each phone using web storage.
- `android/` — Android app written in Kotlin. It opens a validated private-LAN PC IP and loads the same remote controller inside an Android WebView. It remembers only the PC IP and port; the PC still requires its PIN.
- `.github/workflows/android-apk.yml` — automatically creates an installable Android **debug APK** using GitHub Actions. It is available as a private workflow artifact, *not* a public Play Store release.
- `publish-private.bat` — creates the private GitHub repo and pushes files from your PC after you explicitly confirm.

## 1. Start your Windows server

1. Install [Node.js 20+](https://nodejs.org/) and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (already installed if the previous repair compiled).
2. Extract this updated project **into a new folder**. Close the old PC Remote terminal first to free port `7666`.
3. Double-click **`start.bat`**. Wait for the Windows desktop agent build to finish and read the printed `Phone URL` and 8-digit `PAIRING PIN`.
4. Allow Windows Firewall access for **private networks only**, if prompted.
5. To stop access, close the terminal. Do not disable antivirus or bypass Windows protections.

To change the port: in **Command Prompt**, run `set PORT=7777 && start.bat`. Your phone must use the same port.

## 2. Phone browser controller

Open the `Phone URL` in your phone browser on the same private Wi-Fi, enter the PIN, then select **Remote screen**. Tap **Keyboard** to open a real typing panel: first tap a text field on the Windows screen, type into the phone panel, then tap **Send text**. You can use **Backspace** and **Enter** too. The panel now waits for the Windows agent to acknowledge commands and displays delivery errors. Acknowledgement cannot prove the target app used the text: Windows lock/UAC screens and some elevated applications reject input. Tap **⚙ Controls** to customize:

1. Assign a shortcut from the built-in safe list to any button.
2. Reorder buttons using ↑ and ↓, or remove and add buttons (up to 16).
3. Change the number of columns (3–5), button height, and trackpad sensitivity (0.5–2.5×).
4. Toggle the shortcut panel with **Show keys / Hide keys**.

Your settings stay on that phone/browser. Changes affect shortcuts for that phone, **not** the PC's actual keyboard layout. All input still goes through PIN-protected local routes.

## Keyboard troubleshooting

1. In Windows, open **Notepad** and click inside the document using the remote screen controls. (Text cannot be entered on the Windows lock screen, UAC prompts, or some elevated apps.)
2. On the phone, open **Remote screen → Keyboard**. A visible typing box should open and focus; if your Android keyboard does not appear automatically, tap the box.
3. Type `Hello from my phone` and tap **Send text**. The phone waits for an acknowledgement from the Windows desktop agent. Confirm the words appear in Notepad.
4. If the phone shows **Could not send**, check that the desktop is unlocked, that you are paired, and that the PC server terminal is still running. The text stays in the phone field so you can retry.
5. If the phone reports **Windows accepted the keyboard input** but Notepad stays empty, check that Notepad has focus and is not running as administrator. Send the error message and PC server console output when requesting help.

To apply the keyboard fix to an existing installation, **close the old PC Remote host**, extract the new ZIP into a fresh folder, and run `start.bat` there. This update changes the Windows agent, Node server, browser controls, and Android WebView wrapper together; replacing only `index.html` is not sufficient.

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
4. Open **PC Remote**, enter the PC's IP (for example `192.168.8.105`, but use the actual IP displayed by the host) and port `7666`, then connect and enter the PIN displayed in the Windows terminal.
5. Tap **Remote screen** → **⚙ Controls** to personalize on-phone controls.

The Android client uses a normal WebView and loads HTML from your Windows host. **You must run the updated Windows host files for custom controls to appear in the APK.** It doesn't connect over the internet or use a third-party cloud relay.

**APK notes:** Builds from this workflow are *debug* builds and are signed with a GitHub runner's temporary debug keystore. A new build may require uninstalling the old debug APK before installing the next one (losing Android app data). For updateable/release APKs, configure a private signing keystore through GitHub Secrets and a separate release workflow. Do not commit a signing key or store credentials in source control. No APK binary is bundled with the source ZIP — the workflow builds it after the first push. GitHub Actions artifacts require GitHub access to the private repository.

## Developer instructions

- Run `npm test` in the project root to test PIN pairing, authorization, and server-side input validation (doesn't require Windows).
- Open the repository in Android Studio to build the APK locally, or install JDK 17 + Android SDK 35 + Gradle 8.10.2 and run `gradle :android:assembleDebug`.
- Android app uses JavaScript + DOM storage, HTTP access strictly to a manually entered private IPv4 host/port, and no extra Android device privileges (no accessibility, microphone, or remote app installation).
- `.NET 8` agent sources are in `RemoteAgent/`. The original issue (`CS0266` at `Program.cs:188`) is fixed in this version.

## Limitations

- Windows agent captures the **primary monitor** only; it does not bypass UAC prompts or the Windows lock screen.
- PC + phone must use the same trusted LAN; this is **not reverse remote over mobile data/the internet**.
- Android WebView streaming and keyboard behavior depend on the phone's version of Android System WebView; the APK and text injection still need a live Windows/Android test.
- The automated server tests pass, but GitHub-hosted APK build and real Android input/screen usability must be verified after repository creation.
