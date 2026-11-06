# PayKit Android installer

This Android app installs PayKit on your home screen and launches the hosted
PWA in a Trusted Web Activity. It uses the browser's camera permissions,
WebAuthn device unlock, and service worker rather than embedding a WebView.
Android 7 or newer and Chrome or another compatible browser are required. The first launch needs
internet access; later launches can use the PWA's cached shell.

Download `PayKit-Android.apk` from [GitHub Releases](https://github.com/Jethin10/PayKit/releases/latest).
Open it on Android, allow installation from that download source when prompted,
then tap Install. Open PayKit from the home screen.

## Rebuild

Use JDK 17 and Android SDK platform 36. Set `ANDROID_HOME` to your Android SDK
directory, then run `gradlew.bat assembleRelease` on Windows or
`./gradlew assembleRelease` on macOS/Linux from this directory. The output is
`app/build/outputs/apk/release/app-release.apk`.

The GitHub sideload build uses this machine's Android development signing
identity. Keep the same private keystore outside the repository to sign updates.
If another signing identity is used, update the public certificate fingerprint
in `web/public/.well-known/assetlinks.json` and redeploy the PWA. This build is
for direct installation, not a Google Play publication.
