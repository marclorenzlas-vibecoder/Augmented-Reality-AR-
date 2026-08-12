import { StatusBar } from "expo-status-bar";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
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

const stages = ["Scan", "Choose", "Place"];

ViroMaterials.createMaterials({
  markerGreen: {
    diffuseColor: "#1EC8A5",
    lightingModel: "Phong",
  },
  markerBlue: {
    diffuseColor: "#2F80ED",
    lightingModel: "Phong",
  },
  reticle: {
    diffuseColor: "#1EC8A580",
    lightingModel: "Constant",
  },
});

function StepRail({ activeIndex }: { activeIndex: number }) {
  return (
    <View style={styles.stepRail}>
      {stages.map((stage, index) => (
        <View key={stage} style={styles.stepItem}>
          <View style={[styles.stepDot, index <= activeIndex ? styles.stepDotActive : null]}>
            <Text style={[styles.stepNumber, index <= activeIndex ? styles.stepNumberActive : null]}>{index + 1}</Text>
          </View>
          <Text style={[styles.stepLabel, index <= activeIndex ? styles.stepLabelActive : null]}>{stage}</Text>
        </View>
      ))}
    </View>
  );
}

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

        if (mounted) {
          setSetupState("ready");
        }
      } catch (error) {
        console.warn("AR setup failed", error);
        if (mounted) {
          setDetail("AR setup failed on this device");
          setSetupState("error");
        }
      }
    }

    prepareAR();

    return () => {
      mounted = false;
    };
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
    setIsTransitioning(true); // Unmount scanner immediately
    
    // Give expo-camera 900ms to release native camera hardware before starting ARCore
    setTimeout(() => {
      setContent(manifestEntry);
      setIsTransitioning(false); // Mount Viro
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
    if (scannerLocked) {
      return;
    }

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

  const showScanner = !qrPayload && !content && !isTransitioning;

  if (showScanner) {
    if (!cameraPermission) {
      return (
        <SafeAreaView style={styles.centered}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>AR</Text>
          </View>
          <ActivityIndicator color="#1EC8A5" size="large" />
          <Text style={styles.title}>Opening Camera</Text>
          <Text style={styles.message}>Preparing the scanner</Text>
          <StatusBar style="dark" />
        </SafeAreaView>
      );
    }

    if (!cameraPermission.granted) {
      const canRequestAgain = cameraPermission.canAskAgain !== false;

      return (
        <SafeAreaView style={styles.centered}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>AR</Text>
          </View>
          <Text style={styles.title}>Camera Access</Text>
          <Text style={styles.message}>Camera permission is required before the AR experience can open.</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null]}
            onPress={canRequestAgain ? requestCameraPermission : Linking.openSettings}
          >
            <Text style={styles.primaryButtonText}>{canRequestAgain ? "Allow Camera" : "Open Settings"}</Text>
          </Pressable>
          <StatusBar style="dark" />
        </SafeAreaView>
      );
    }

    return (
      <View style={styles.container}>
        <CameraView
          active={!scannerLocked}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          facing="back"
          onBarcodeScanned={scannerLocked ? undefined : handleQrScanned}
          style={styles.camera}
        />
        <SafeAreaView pointerEvents="box-none" style={styles.scannerOverlay}>
          <View style={styles.scannerTopBar}>
            <View>
              <Text style={styles.brandEyebrow}>Augmented Reality</Text>
              <Text style={styles.scannerTitle}>Scan QR</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>

          <View style={styles.scanZone}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              <View style={styles.scanLine} />
            </View>
          </View>

          <View style={styles.scannerPanel}>
            <StepRail activeIndex={0} />
            <Text style={styles.panelTitle}>Ready For QR</Text>
            <Text style={styles.panelText}>Point your camera at the code near the mural.</Text>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null, { marginTop: 12 }]}
              onPress={() => resolveContent("testcar")}
            >
              <Text style={styles.secondaryButtonText}>Quick Test: Mazda RX-77</Text>
            </Pressable>
          </View>
        </SafeAreaView>
        <StatusBar style="light" />
      </View>
    );
  }

  if (missingContentId) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>AR</Text>
        </View>
        <Text style={styles.title}>Content Coming Soon</Text>
        <Text style={styles.message}>QR ID "{missingContentId}" was detected, but it is not in the content manifest yet.</Text>
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null]} onPress={resetScan}>
          <Text style={styles.primaryButtonText}>Scan Another QR</Text>
        </Pressable>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  if (choices.length > 0 && !selectedChoice) {
    return (
      <SafeAreaView style={styles.choiceScreen}>
        <View style={styles.choiceHeader}>
          <View style={styles.brandMarkSmall}>
            <Text style={styles.brandMarkTextSmall}>AR</Text>
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.brandEyebrowDark}>Augmented Reality</Text>
            <Text style={styles.choiceTitle}>Select Experience</Text>
          </View>
        </View>

        <StepRail activeIndex={1} />
        <Text style={styles.choiceMessage}>This QR code includes {choices.length} options.</Text>

        <ScrollView contentContainerStyle={styles.choiceList}>
          {choices.map((choice, index) => (
            <Pressable
              key={choice.id}
              style={({ pressed }) => [styles.choiceButton, pressed ? styles.choiceButtonPressed : null]}
              onPress={() => handleChoiceSelected(choice)}
            >
              <View style={styles.choiceIndex}>
                <Text style={styles.choiceIndexText}>{index + 1}</Text>
              </View>
              <Text numberOfLines={2} style={styles.choiceText}>
                {choice.label}
              </Text>
              <Text style={styles.choiceAction}>Open</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]} onPress={resetScan}>
          <Text style={styles.secondaryButtonText}>Scan Again</Text>
        </Pressable>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  if (isTransitioning || setupState !== "ready") {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>AR</Text>
        </View>
        {setupState === "checking" ? <ActivityIndicator color="#1EC8A5" size="large" /> : null}
        <Text style={styles.title}>{setupState === "checking" ? "Preparing Spatial View" : "AR Unavailable"}</Text>
        <Text style={styles.message}>{detail}</Text>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  if (!content) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        autofocus
        initialScene={{ scene: ARExperienceScene }}
        key={content.id}
        style={styles.arView}
        viroAppProps={{
          content,
          qrPayload,
          selectedChoice,
          onTrackingChange: setIsTrackingAnchor,
          isPlaced: isModelPlaced,
          onPlacementStateChange: setIsModelPlaced,
        }}
      />
      <SafeAreaView pointerEvents="none" style={styles.arOverlay}>
        <View style={styles.arTopPanel}>
          <View>
            <Text style={styles.arEyebrow}>Spatial View</Text>
            <Text numberOfLines={1} style={styles.arTitle}>
              {content.name}
            </Text>
          </View>
          <View style={styles.arStatusBadge}>
            <Text style={styles.arStatusText}>
              {trackingTarget
                ? isTrackingAnchor
                  ? "LOCKED"
                  : "FIND QR"
                : isModelPlaced
                ? "PLACED"
                : "TARGETING"}
            </Text>
          </View>
        </View>

        <View style={styles.arBottomPanel}>
          <StepRail activeIndex={2} />
          <Text style={styles.arHint}>
            {trackingTarget
              ? isTrackingAnchor
                ? "Content is anchored to the QR marker."
                : "Point the camera back at the QR code to lock the mural content."
              : isModelPlaced
              ? "Drag to slide along the ground. Pinch to resize. Two-finger twist to rotate."
              : "Point your camera at the floor. Tap a highlighted surface to choose where to place the model."}
          </Text>
          {!trackingTarget && isModelPlaced ? (
            <Pressable
              pointerEvents="auto"
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null, { marginTop: 10 }]}
              onPress={() => setIsModelPlaced(false)}
            >
              <Text style={styles.secondaryButtonText}>Reposition</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#05070A",
    flex: 1,
  },
  arView: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  centered: {
    alignItems: "center",
    backgroundColor: "#F6F1E8",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  brandMark: {
    alignItems: "center",
    backgroundColor: "#0E1918",
    borderRadius: 8,
    height: 64,
    justifyContent: "center",
    marginBottom: 22,
    width: 64,
  },
  brandMarkText: {
    color: "#1EC8A5",
    fontSize: 24,
    fontWeight: "900",
  },
  brandMarkSmall: {
    alignItems: "center",
    backgroundColor: "#0E1918",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  brandMarkTextSmall: {
    color: "#1EC8A5",
    fontSize: 18,
    fontWeight: "900",
  },
  title: {
    color: "#102027",
    fontSize: 25,
    fontWeight: "800",
    marginTop: 16,
    textAlign: "center",
  },
  message: {
    color: "#53666E",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 330,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#0E1918",
    borderRadius: 8,
    marginTop: 22,
    minWidth: 168,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#0E1918",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: "#0E1918",
    fontSize: 16,
    fontWeight: "800",
  },
  buttonPressed: {
    opacity: 0.78,
  },
  scannerOverlay: {
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    padding: 18,
    position: "absolute",
    right: 0,
    top: 0,
  },
  scannerTopBar: {
    alignItems: "center",
    backgroundColor: "rgba(5, 7, 10, 0.78)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  brandEyebrow: {
    color: "#9DE7D7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  brandEyebrowDark: {
    color: "#2E7D70",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
    marginTop: 2,
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: "rgba(30, 200, 165, 0.16)",
    borderColor: "rgba(30, 200, 165, 0.5)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  liveDot: {
    backgroundColor: "#1EC8A5",
    borderRadius: 5,
    height: 9,
    marginRight: 7,
    width: 9,
  },
  liveText: {
    color: "#DFFCF5",
    fontSize: 12,
    fontWeight: "900",
  },
  scanZone: {
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    aspectRatio: 1,
    backgroundColor: "rgba(5, 7, 10, 0.12)",
    maxWidth: 310,
    position: "relative",
    width: "78%",
  },
  corner: {
    borderColor: "#1EC8A5",
    height: 48,
    position: "absolute",
    width: 48,
  },
  cornerTopLeft: {
    borderLeftWidth: 5,
    borderTopWidth: 5,
    left: 0,
    top: 0,
  },
  cornerTopRight: {
    borderRightWidth: 5,
    borderTopWidth: 5,
    right: 0,
    top: 0,
  },
  cornerBottomLeft: {
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    bottom: 0,
    left: 0,
  },
  cornerBottomRight: {
    borderBottomWidth: 5,
    borderRightWidth: 5,
    bottom: 0,
    right: 0,
  },
  scanLine: {
    backgroundColor: "#F2C14E",
    height: 3,
    left: 18,
    position: "absolute",
    right: 18,
    top: "50%",
  },
  scannerPanel: {
    backgroundColor: "rgba(246, 241, 232, 0.94)",
    borderColor: "rgba(14, 25, 24, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  panelTitle: {
    color: "#102027",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 14,
  },
  panelText: {
    color: "#53666E",
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
  },
  stepRail: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
  },
  stepDot: {
    alignItems: "center",
    backgroundColor: "rgba(16, 32, 39, 0.08)",
    borderColor: "rgba(16, 32, 39, 0.16)",
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  stepDotActive: {
    backgroundColor: "#0E1918",
    borderColor: "#0E1918",
  },
  stepNumber: {
    color: "#6E7F85",
    fontSize: 12,
    fontWeight: "900",
  },
  stepNumberActive: {
    color: "#1EC8A5",
  },
  stepLabel: {
    color: "#6E7F85",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  stepLabelActive: {
    color: "#102027",
  },
  choiceScreen: {
    backgroundColor: "#F6F1E8",
    flex: 1,
    padding: 20,
  },
  choiceHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 24,
  },
  headerTextBlock: {
    flex: 1,
    marginLeft: 12,
  },
  choiceTitle: {
    color: "#102027",
    fontSize: 27,
    fontWeight: "900",
  },
  choiceMessage: {
    color: "#53666E",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 22,
  },
  choiceList: {
    paddingBottom: 24,
    paddingTop: 16,
  },
  choiceButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#CAD8D4",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 12,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  choiceButtonPressed: {
    backgroundColor: "#EDF8F5",
  },
  choiceIndex: {
    alignItems: "center",
    backgroundColor: "#E8F5F1",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    marginRight: 12,
    width: 36,
  },
  choiceIndexText: {
    color: "#0E6657",
    fontSize: 14,
    fontWeight: "900",
  },
  choiceText: {
    color: "#102027",
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
  },
  choiceAction: {
    color: "#2F80ED",
    fontSize: 14,
    fontWeight: "900",
    marginLeft: 12,
  },
  arOverlay: {
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    padding: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
  arTopPanel: {
    alignItems: "center",
    backgroundColor: "rgba(5, 7, 10, 0.72)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  arEyebrow: {
    color: "#9DE7D7",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  arTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
    marginTop: 2,
    maxWidth: 230,
  },
  arStatusBadge: {
    backgroundColor: "rgba(242, 193, 78, 0.16)",
    borderColor: "rgba(242, 193, 78, 0.6)",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  arStatusText: {
    color: "#FFE6A3",
    fontSize: 12,
    fontWeight: "900",
  },
  arBottomPanel: {
    backgroundColor: "rgba(246, 241, 232, 0.94)",
    borderRadius: 8,
    padding: 14,
  },
  arHint: {
    color: "#102027",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: 14,
    textAlign: "center",
  },
});
