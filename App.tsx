import { StatusBar } from "expo-status-bar";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  NativeModules,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";
import {
  isARSupportedOnDevice,
  requestRequiredPermissions,
  ViroARSceneNavigator,
  ViroMaterials,
} from "@reactvision/react-viro";

import ARExperienceScene from "./src/ARExperienceScene";
import { contentManifest, ContentChoice, MuralContent } from "./src/contentManifest";
import { getTrackingTarget } from "./src/arTargets";
import { parseQrPayload, QrPayload } from "./src/qrPayload";

type SetupState = "checking" | "ready" | "unsupported" | "permission-denied" | "error";
type FlashMode = "auto" | "on" | "off";

export function initViroMaterials() {
  const manager =
    NativeModules.VRTMaterialManager ||
    (TurboModuleRegistry ? TurboModuleRegistry.get("VRTMaterialManager") : null);

  if (manager && ViroMaterials?.createMaterials) {
    try {
      ViroMaterials.createMaterials({
        markerGreen: { diffuseColor: "#1EC8A5", lightingModel: "Phong" },
        markerBlue: { diffuseColor: "#2F80ED", lightingModel: "Phong" },
        reticle: { diffuseColor: "#1EC8A580", lightingModel: "Constant" },
      });
    } catch (e) {
      console.warn("ViroMaterials initialization skipped:", e);
    }
  }
}

initViroMaterials();

// Animated scan line
function ScanLine({ locked }: { locked: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (locked) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [locked]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-110, 110] });

  return (
    <Animated.View
      style={[styles.scanLine, { transform: [{ translateY }], opacity: locked ? 0 : 1 }]}
    />
  );
}

// Top camera controls bar
function TopControlsBar({
  flash,
  onFlashToggle,
}: {
  flash: FlashMode;
  onFlashToggle: () => void;
}) {
  const flashLabel = flash === "auto" ? "A" : flash === "on" ? "ON" : "OFF";
  const flashColor = flash === "on" ? "#F2C14E" : flash === "off" ? "#94A3B8" : "#1EC8A5";

  return (
    <View style={styles.topControlsBar}>
      <Pressable style={[styles.topIconPill, { borderColor: flashColor + "80" }]} onPress={onFlashToggle}>
        <Text style={[styles.topIconText, { color: flashColor }]}>{"⚡ " + flashLabel}</Text>
      </Pressable>
      <View style={styles.appNameBadge}>
        <View style={styles.appNameDot} />
        <Text style={styles.appNameText}>AR STUDIO</Text>
      </View>
      <View style={[styles.topIconPill, { borderColor: "#1EC8A580" }]}>
        <Text style={[styles.topIconText, { color: "#1EC8A5" }]}>
          {"SCAN QR"}
        </Text>
      </View>
    </View>
  );
}

// Zoom selector
function ZoomSelector() {
  const [zoom, setZoom] = useState("1x");
  const zooms = [".5x", "1x", "2x"];
  return (
    <View style={styles.zoomRow}>
      {zooms.map((z) => (
        <Pressable key={z} style={[styles.zoomBtn, zoom === z && styles.zoomBtnActive]} onPress={() => setZoom(z)}>
          <Text style={[styles.zoomText, zoom === z && styles.zoomTextActive]}>{z}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Status pill
function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.statusPill, { borderColor: color + "99", backgroundColor: color + "22" }]}>
      <View style={[styles.statusPillDot, { backgroundColor: color }]} />
      <Text style={[styles.statusPillText, { color }]}>{label}</Text>
    </View>
  );
}

// Shutter bar
function ShutterBar({
  onGallery,
  onFlip,
}: {
  onGallery: () => void;
  onFlip: () => void;
}) {
  return (
    <View style={styles.shutterBar}>
      <Pressable style={styles.galleryBtn} onPress={onGallery}>
        <View style={styles.galleryThumb}>
          <Text style={styles.galleryThumbIcon}>{"🚗"}</Text>
        </View>
        <Text style={styles.galleryLabel}>Test AR</Text>
      </Pressable>
      <View style={styles.scanTargetBadge}>
        <Text style={styles.scanTargetText}>AUTO SCANNING</Text>
      </View>
      <Pressable style={styles.flipBtn} onPress={onFlip}>
        <Text style={styles.flipIcon}>{"🔄"}</Text>
        <Text style={styles.flipLabel}>Flip</Text>
      </Pressable>
    </View>
  );
}

// Main App
export default function App() {
  const [setupState, setSetupState] = useState<SetupState>("checking");
  const [detail, setDetail] = useState("Preparing AR");
  const [qrPayload, setQrPayload] = useState<QrPayload | null>(null);
  const [choices, setChoices] = useState<ContentChoice[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<ContentChoice | null>(null);
  const [content, setContent] = useState<MuralContent | null>(null);
  const [missingContentId, setMissingContentId] = useState<string | null>(null);
  const [isTrackingAnchor, setIsTrackingAnchor] = useState(false);
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerLocked, setScannerLocked] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [flash, setFlash] = useState<FlashMode>("auto");
  const [facing, setFacing] = useState<"front" | "back">("back");

  const arUnlocked = Boolean(content);
  const trackingTarget = content ? getTrackingTarget(content) : undefined;

  useEffect(() => {
    let mounted = true;

    async function prepareAR() {
      if (!arUnlocked) {
        setSetupState("checking");
        setDetail(qrPayload ? "Resolving mural content" : "Scan a QR code to start AR");
        return;
      }
      if (Platform.OS === "web") {
        setDetail("AR needs an Android or iOS build");
        setSetupState("unsupported");
        return;
      }
      if (!NativeModules.VRTARSceneNavigatorModule) {
        setDetail("Native 3D AR requires a Development Build (npx expo run:android). In Expo Go, Camera & QR Scanner features are fully active.");
        setSetupState("unsupported");
        return;
      }
      try {
        const support = await isARSupportedOnDevice();
        if (!support.isARSupported) {
          setDetail("This device does not report ARCore/ARKit support");
          setSetupState("unsupported");
          return;
        }
        const permissions = await requestRequiredPermissions(["camera"]);
        if (!permissions.camera) {
          setDetail("Camera permission is required");
          setSetupState("permission-denied");
          return;
        }
        if (mounted) setSetupState("ready");
      } catch (error) {
        console.warn("AR setup failed", error);
        if (mounted) {
          setDetail("AR setup failed on this device");
          setSetupState("error");
        }
      }
    }

    prepareAR();
    return () => { mounted = false; };
  }, [arUnlocked, qrPayload]);

  function resolveContent(contentId: string, choice?: ContentChoice) {
    const manifestEntry = contentManifest[contentId];
    setSelectedChoice(choice ?? null);
    if (!manifestEntry) {
      setMissingContentId(contentId);
      setContent(null);
      setSetupState("checking");
      setDetail("Content coming soon");
      return;
    }
    setMissingContentId(null);
    setDetail(`Loading ${manifestEntry.name}`);
    setIsTrackingAnchor(false);
    setIsModelPlaced(false);
    setIsTransitioning(true);
    setTimeout(() => {
      setContent(manifestEntry);
      setIsTransitioning(false);
    }, 900);
  }

  function resetScan() {
    setQrPayload(null);
    setChoices([]);
    setSelectedChoice(null);
    setContent(null);
    setMissingContentId(null);
    setIsTrackingAnchor(false);
    setIsModelPlaced(false);
    setScannerLocked(false);
    setIsTransitioning(false);
    setSetupState("checking");
    setDetail("Scan a QR code to start AR");
  }

  function handleQrScanned(result: BarcodeScanningResult) {
    if (scannerLocked) return;
    const parsedPayload = parseQrPayload(result.data);
    setScannerLocked(true);
    setQrPayload(parsedPayload);
    setChoices(parsedPayload.choices);
    setSelectedChoice(null);
    if (parsedPayload.choices.length > 0) {
      setDetail("QR code scanned. Choose an option");
      return;
    }
    resolveContent(parsedPayload.qrId);
  }

  function handleChoiceSelected(choice: ContentChoice) {
    resolveContent(choice.contentId, choice);
  }

  function cycleFlash() {
    setFlash((f) => (f === "auto" ? "on" : f === "on" ? "off" : "auto"));
  }

  function flipCamera() {
    setFacing((f) => (f === "back" ? "front" : "back"));
  }

  const showScanner = !qrPayload && !content && !isTransitioning;

  // Permission loading
  if (showScanner && !cameraPermission) {
    return (
      <View style={styles.splashBg}>
        <View style={styles.splashCard}>
          <View style={styles.splashLogo}>
            <Text style={styles.splashLogoText}>AR</Text>
          </View>
          <ActivityIndicator color="#1EC8A5" size="large" style={{ marginTop: 24 }} />
          <Text style={styles.splashTitle}>Opening Camera</Text>
          <Text style={styles.splashSub}>Preparing the scanner...</Text>
        </View>
        <StatusBar style="light" />
      </View>
    );
  }

  // Permission denied
  if (showScanner && cameraPermission && !cameraPermission.granted) {
    const canRequest = cameraPermission.canAskAgain !== false;
    return (
      <View style={styles.splashBg}>
        <View style={styles.splashCard}>
          <View style={styles.splashLogo}>
            <Text style={styles.splashLogoText}>AR</Text>
          </View>
          <Text style={styles.splashTitle}>Camera Access</Text>
          <Text style={styles.splashSub}>Camera permission is required before the AR experience can open.</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
            onPress={canRequest ? requestCameraPermission : Linking.openSettings}
          >
            <Text style={styles.primaryBtnText}>{canRequest ? "Allow Camera" : "Open Settings"}</Text>
          </Pressable>
        </View>
        <StatusBar style="light" />
      </View>
    );
  }

  // Main camera / scanner view
  if (showScanner && cameraPermission?.granted) {
    return (
      <View style={styles.cameraRoot}>
        <CameraView
          active={!scannerLocked}
          facing={facing}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={!scannerLocked ? handleQrScanned : undefined}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={styles.cameraUI} pointerEvents="box-none">
          <TopControlsBar flash={flash} onFlashToggle={cycleFlash} />
          <View style={styles.viewfinder} pointerEvents="none">
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cTL]} />
              <View style={[styles.corner, styles.cTR]} />
              <View style={[styles.corner, styles.cBL]} />
              <View style={[styles.corner, styles.cBR]} />
              <ScanLine locked={scannerLocked} />
              <View style={styles.crosshair} />
              <Text style={styles.scanHintText}>Align QR code within frame</Text>
            </View>
          </View>
          <ZoomSelector />
          <ShutterBar
            onGallery={() => resolveContent("testcar")}
            onFlip={flipCamera}
          />
        </SafeAreaView>
        <StatusBar style="light" />
      </View>
    );
  }

  // Content missing
  if (missingContentId) {
    return (
      <View style={styles.splashBg}>
        <View style={styles.splashCard}>
          <View style={[styles.splashLogo, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B44" }]}>
            <Text style={[styles.splashLogoText, { color: "#F59E0B" }]}>!</Text>
          </View>
          <Text style={styles.splashTitle}>Content Coming Soon</Text>
          <Text style={styles.splashSub}>QR ID "{missingContentId}" was detected, but is not in the content manifest yet.</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
            onPress={resetScan}
          >
            <Text style={styles.primaryBtnText}>Scan Another QR</Text>
          </Pressable>
        </View>
        <StatusBar style="light" />
      </View>
    );
  }

  // Choice selection
  if (choices.length > 0 && !selectedChoice) {
    return (
      <View style={styles.choiceRoot}>
        <SafeAreaView style={styles.choiceSafeArea}>
          <View style={styles.choiceHeader}>
            <View style={styles.splashLogo}>
              <Text style={styles.splashLogoText}>AR</Text>
            </View>
            <View style={{ marginLeft: 14 }}>
              <Text style={styles.choiceEyebrow}>AR STUDIO</Text>
              <Text style={styles.choiceTitle}>Select Experience</Text>
            </View>
          </View>
          <Text style={styles.choiceSubtitle}>This QR includes {choices.length} AR experiences</Text>
          <ScrollView contentContainerStyle={styles.choiceList} showsVerticalScrollIndicator={false}>
            {choices.map((choice, index) => (
              <Pressable
                key={choice.id}
                style={({ pressed }) => [styles.choiceCard, pressed && styles.choiceCardPressed]}
                onPress={() => handleChoiceSelected(choice)}
              >
                <View style={styles.choiceCardNum}>
                  <Text style={styles.choiceCardNumText}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceCardLabel} numberOfLines={2}>{choice.label}</Text>
                  <Text style={styles.choiceCardSub}>Tap to launch AR experience</Text>
                </View>
                <Text style={styles.choiceCardArrow}>{">"}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
            onPress={resetScan}
          >
            <Text style={styles.ghostBtnText}>Scan Again</Text>
          </Pressable>
        </SafeAreaView>
        <StatusBar style="light" />
      </View>
    );
  }

  // Loading / transitioning
  if (isTransitioning || setupState !== "ready") {
    return (
      <View style={styles.splashBg}>
        <View style={styles.splashCard}>
          <View style={styles.splashLogo}>
            <Text style={styles.splashLogoText}>AR</Text>
          </View>
          {setupState === "checking" ? (
            <ActivityIndicator color="#1EC8A5" size="large" style={{ marginTop: 24 }} />
          ) : null}
          <Text style={styles.splashTitle}>
            {setupState === "checking" ? "Preparing Spatial View" : "AR Unavailable"}
          </Text>
          <Text style={styles.splashSub}>{detail}</Text>
        </View>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!content) return null;

  // AR Spatial View
  const trackingStatus = trackingTarget
    ? isTrackingAnchor ? "LOCKED" : "FIND QR"
    : isModelPlaced ? "PLACED" : "TARGETING";

  const statusColor = trackingStatus === "LOCKED" || trackingStatus === "PLACED"
    ? "#1EC8A5"
    : trackingStatus === "FIND QR"
      ? "#F2C14E"
      : "#94A3B8";

  const arHint = trackingTarget
    ? isTrackingAnchor
      ? "Content is anchored to the QR marker."
      : "Point camera back at the QR code to lock content."
    : isModelPlaced
      ? "Drag to slide. Pinch to resize. Two-finger twist to rotate."
      : "Point camera at floor. Tap a surface to place model.";

  return (
    <View style={styles.cameraRoot}>
      <ViroARSceneNavigator
        autofocus
        initialScene={{ scene: ARExperienceScene }}
        key={content.id}
        style={StyleSheet.absoluteFillObject}
        viroAppProps={{
          content,
          qrPayload,
          selectedChoice,
          onTrackingChange: setIsTrackingAnchor,
          isPlaced: isModelPlaced,
          onPlacementStateChange: setIsModelPlaced,
        }}
      />
      <SafeAreaView style={styles.arHudSafeArea} pointerEvents="box-none">
        <View style={styles.arTopBar}>
          <Pressable style={styles.arBackBtn} onPress={resetScan} pointerEvents="auto">
            <Text style={styles.arBackIcon}>{"<"}</Text>
            <Text style={styles.arBackText}>Camera</Text>
          </Pressable>
          <View style={styles.arContentInfo}>
            <Text style={styles.arContentName} numberOfLines={1}>{content.name}</Text>
            <Text style={styles.arContentSub}>Spatial View</Text>
          </View>
          <StatusPill label={trackingStatus} color={statusColor} />
        </View>
        <View style={styles.arHintBubbleWrap} pointerEvents="none">
          <View style={styles.arHintBubble}>
            <Text style={styles.arHintText}>{arHint}</Text>
          </View>
        </View>
        <View style={styles.arBottomBar}>
          {!trackingTarget && isModelPlaced ? (
            <Pressable
              style={({ pressed }) => [styles.arActionBtn, pressed && styles.btnPressed]}
              onPress={() => setIsModelPlaced(false)}
              pointerEvents="auto"
            >
              <Text style={styles.arActionBtnText}>Reposition</Text>
            </Pressable>
          ) : <View style={{ width: 48 }} />}
          <View style={styles.arShutterOuter}>
            <View style={styles.arShutterInner}>
              <Text style={styles.arShutterIcon}>AR</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.arResetBtn, pressed && styles.btnPressed]}
            onPress={resetScan}
            pointerEvents="auto"
          >
            <Text style={styles.arResetIcon}>X</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  cameraRoot: {
    backgroundColor: "#000",
    flex: 1,
  },
  btnPressed: {
    opacity: 0.72,
  },
  splashBg: {
    alignItems: "center",
    backgroundColor: "#050D0C",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  splashCard: {
    alignItems: "center",
    backgroundColor: "#0C1A18",
    borderColor: "#1EC8A520",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 360,
    padding: 36,
    width: "100%",
  },
  splashLogo: {
    alignItems: "center",
    backgroundColor: "#0E2420",
    borderColor: "#1EC8A530",
    borderRadius: 16,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  splashLogoText: {
    color: "#1EC8A5",
    fontSize: 26,
    fontWeight: "900",
  },
  splashTitle: {
    color: "#E2FFF9",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 20,
    textAlign: "center",
  },
  splashSub: {
    color: "#6ECAB8",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: "#1EC8A5",
    borderRadius: 12,
    marginTop: 22,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  primaryBtnText: {
    color: "#050D0C",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  cameraUI: {
    flex: 1,
    justifyContent: "space-between",
  },
  topControlsBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: (RNStatusBar.currentHeight ?? 24) + 8,
  },
  topIconPill: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topIconText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  appNameBadge: {
    alignItems: "center",
    flexDirection: "row",
  },
  appNameDot: {
    backgroundColor: "#1EC8A5",
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  appNameText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
  },
  viewfinder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  scanFrame: {
    alignItems: "center",
    aspectRatio: 1,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: "72%",
  },
  corner: {
    borderColor: "#1EC8A5",
    height: 40,
    position: "absolute",
    width: 40,
  },
  cTL: { borderLeftWidth: 4, borderTopWidth: 4, left: 0, top: 0, borderTopLeftRadius: 6 },
  cTR: { borderRightWidth: 4, borderTopWidth: 4, right: 0, top: 0, borderTopRightRadius: 6 },
  cBL: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0, borderBottomLeftRadius: 6 },
  cBR: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0, borderBottomRightRadius: 6 },
  scanLine: {
    backgroundColor: "#1EC8A5",
    height: 2,
    left: 12,
    position: "absolute",
    right: 12,
    shadowColor: "#1EC8A5",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  crosshair: {
    backgroundColor: "transparent",
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    width: 40,
  },
  scanHintText: {
    bottom: -28,
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "600",
    position: "absolute",
    textAlign: "center",
    width: "100%",
  },
  zoomRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 10,
    gap: 8,
  },
  zoomBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  zoomBtnActive: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderColor: "#FFFFFF",
    borderWidth: 1,
  },
  zoomText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "700",
  },
  zoomTextActive: {
    color: "#FFFFFF",
  },
  shutterBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 20,
    paddingHorizontal: 32,
  },
  scanTargetBadge: {
    alignItems: "center",
    backgroundColor: "rgba(30, 200, 165, 0.15)",
    borderColor: "rgba(30, 200, 165, 0.4)",
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  scanTargetText: {
    color: "#1EC8A5",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  galleryBtn: {
    alignItems: "center",
    width: 64,
  },
  galleryThumb: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: 12,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  galleryThumbIcon: {
    fontSize: 24,
  },
  galleryLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
    textAlign: "center",
  },
  flipBtn: {
    alignItems: "center",
    width: 64,
  },
  flipIcon: {
    fontSize: 24,
  },
  flipLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
  },
  choiceRoot: {
    backgroundColor: "#050D0C",
    flex: 1,
  },
  choiceSafeArea: {
    flex: 1,
    padding: 20,
  },
  choiceHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 8,
  },
  choiceEyebrow: {
    color: "#1EC8A5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  choiceTitle: {
    color: "#E2FFF9",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 2,
  },
  choiceSubtitle: {
    color: "#6ECAB8",
    fontSize: 14,
    marginBottom: 16,
    marginTop: 16,
  },
  choiceList: {
    paddingBottom: 16,
    gap: 12,
  },
  choiceCard: {
    alignItems: "center",
    backgroundColor: "#0C1A18",
    borderColor: "#1EC8A520",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  choiceCardPressed: {
    backgroundColor: "#132820",
    borderColor: "#1EC8A550",
  },
  choiceCardNum: {
    alignItems: "center",
    backgroundColor: "#1EC8A520",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    marginRight: 14,
    width: 40,
  },
  choiceCardNumText: {
    color: "#1EC8A5",
    fontSize: 16,
    fontWeight: "900",
  },
  choiceCardLabel: {
    color: "#E2FFF9",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  choiceCardSub: {
    color: "#6ECAB8",
    fontSize: 12,
    marginTop: 2,
  },
  choiceCardArrow: {
    color: "#1EC8A5",
    fontSize: 24,
    fontWeight: "300",
    marginLeft: 8,
  },
  ghostBtn: {
    alignItems: "center",
    borderColor: "#1EC8A530",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 14,
  },
  ghostBtnText: {
    color: "#6ECAB8",
    fontSize: 14,
    fontWeight: "700",
  },
  statusPill: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillDot: {
    borderRadius: 4,
    height: 7,
    marginRight: 5,
    width: 7,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  arHudSafeArea: {
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  arTopBar: {
    alignItems: "center",
    backgroundColor: "rgba(5, 13, 12, 0.75)",
    borderBottomColor: "rgba(30,200,165,0.15)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  arBackBtn: {
    alignItems: "center",
    flexDirection: "row",
  },
  arBackIcon: {
    color: "#1EC8A5",
    fontSize: 22,
    fontWeight: "300",
    lineHeight: 26,
  },
  arBackText: {
    color: "#1EC8A5",
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 4,
  },
  arContentInfo: {
    alignItems: "center",
    flex: 1,
    marginHorizontal: 12,
  },
  arContentName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  arContentSub: {
    color: "#6ECAB8",
    fontSize: 11,
    marginTop: 1,
  },
  arHintBubbleWrap: {
    alignItems: "center",
    padding: 16,
  },
  arHintBubble: {
    backgroundColor: "rgba(5,13,12,0.78)",
    borderColor: "rgba(30,200,165,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 320,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  arHintText: {
    color: "#C8EFE8",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
  arBottomBar: {
    alignItems: "center",
    backgroundColor: "rgba(5, 13, 12, 0.75)",
    borderTopColor: "rgba(30,200,165,0.15)",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 24,
    paddingHorizontal: 28,
    paddingTop: 16,
  },
  arActionBtn: {
    backgroundColor: "#1EC8A520",
    borderColor: "#1EC8A540",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  arActionBtnText: {
    color: "#1EC8A5",
    fontSize: 13,
    fontWeight: "800",
  },
  arShutterOuter: {
    alignItems: "center",
    borderColor: "#1EC8A5",
    borderRadius: 40,
    borderWidth: 2.5,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  arShutterInner: {
    alignItems: "center",
    backgroundColor: "#1EC8A520",
    borderRadius: 32,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  arShutterIcon: {
    color: "#1EC8A5",
    fontSize: 14,
    fontWeight: "900",
  },
  arResetBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  arResetIcon: {
    color: "#94A3B8",
    fontSize: 16,
    fontWeight: "700",
  },
});
