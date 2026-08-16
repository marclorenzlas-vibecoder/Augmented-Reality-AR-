# Augmented Reality AR Starter

React Native + Expo + ViroReact starter for a QR-triggered mural tourism AR viewer.

The app starts with a QR-code scanner. After a QR code is scanned, it extracts a QR/content ID, looks it up in the local manifest, then opens AR for the matching mural content.

If the scanned QR code contains choices, the app shows those choices first. If it does not contain choices, the app starts AR immediately.

If the QR ID is not in the manifest, the app shows a "Content coming soon" fallback.

QR choices can be encoded as JSON:

```json
{"choices":["Museum Guide","Product Demo","Training Mode"]}
```

Or as a URL query:

```text
https://example.com/ar?choices=Museum%20Guide,Product%20Demo,Training%20Mode
```

Plain mural IDs also work:

```text
mural_001
```

URL QR IDs also work:

```text
https://example.com/ar?id=mural_001
```

## Content Manifest

Edit [src/contentManifest.ts](src/contentManifest.ts) to add mural content:

```ts
mural_001: {
  id: "mural_001",
  name: "Maskara Dance - Bacolod Plaza",
  description: "A placeholder Maskara-inspired AR performance for mural testing.",
  assetType: "placeholder",
  scale: 1,
  loop: true,
}
```

When the real animated GLB is ready, set `assetType: "GLB"` and add `assetUrlAndroid`.

## QR Image Tracking

The app supports Viro image-marker tracking, but the actual printed QR image must be bundled as a registered AR tracking target. Add final QR target images in [src/arTargets.ts](src/arTargets.ts). Until a target image is registered for a mural, the app uses development placement: it detects a plane and lets the user tap to place the placeholder content.

## Requirements

- Node.js
- Android Studio with the Android SDK
- An ARCore-compatible Android phone
- USB debugging enabled on the phone for local testing

ViroReact uses native AR code, so this app will not run in Expo Go. Use a native build through `expo run:android` or create an APK.

## Setup

```bash
npm install
```

## Run On Android

Connect an Android phone, then run:

```bash
npm run android
```

## Build APK

To build the debug APK (ready to install on any Android phone):

```bash
npm run build:android:debug
```

The APK is created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Or run `npm run build:android:apk` to build the release APK.
