import { StatusBar } from "expo-status-bar";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  NativeModules,
  PanResponder,
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

type SetupState = "checking" | "ready" | "unsupported" | "permission-denied" | "error" | "navigating";

export function initViroMaterials() {
  const manager =
    NativeModules.VRTMaterialManager ||
    (TurboModuleRegistry ? TurboModuleRegistry.get("VRTMaterialManager") : null);

  if (manager && ViroMaterials?.createMaterials) {
    try {
      ViroMaterials.createMaterials({
        markerGreen: { diffuseColor: "#3B82F6", lightingModel: "Phong" },
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
function TopControlsBar() {
  return (
    <View style={styles.topControlsBar}>
      <View style={styles.appNameBadge}>
        <Text style={styles.appNameText}>AR STUDIO</Text>
      </View>
    </View>
  );
}

const ZOOM_PRESETS = [
  { label: "1x", value: 0 },
  { label: "2x", value: 0.25 },
  { label: "3x", value: 0.5 },
];

// Zoom selector
function ZoomSelector({
  currentZoom,
  onZoomChange,
}: {
  currentZoom: number;
  onZoomChange: (z: number) => void;
}) {
  return (
    <View style={styles.zoomRow}>
      {ZOOM_PRESETS.map((preset) => {
        const isActive = Math.abs(currentZoom - preset.value) < 0.05;
        return (
          <Pressable
            key={preset.label}
            style={[styles.zoomBtn, isActive && styles.zoomBtnActive]}
            onPress={() => onZoomChange(preset.value)}
          >
            <Text style={[styles.zoomText, isActive && styles.zoomTextActive]}>
              {preset.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Floating auto-dismissing hint bubble (disappears after 5 seconds)
function FloatingHintBubble({ text }: { text: string }) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    fadeAnim.setValue(1);
    setVisible(true);
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, [text]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.arHintBubbleWrap, { opacity: fadeAnim }]} pointerEvents="none">
      <View style={styles.arHintBubble}>
        <Text style={styles.arHintText}>{text}</Text>
      </View>
    </Animated.View>
  );
}

// Floating Quick Zoom & Reset controls (fades in after 6 seconds)
function FloatingSideControls({
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    fadeAnim.setValue(0);
    setVisible(false);
    const timer = setTimeout(() => {
      setVisible(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 6000);

    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.arSideControls, { opacity: fadeAnim }]} pointerEvents="auto">
      <Pressable
        style={({ pressed }) => [styles.arSideBtn, pressed && styles.btnPressed]}
        onPress={onZoomIn}
      >
        <Ionicons name="add" size={20} color="#3B82F6" />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.arSideBtn, pressed && styles.btnPressed]}
        onPress={onZoomOut}
      >
        <Ionicons name="remove" size={20} color="#3B82F6" />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.arSideBtn, pressed && styles.btnPressed]}
        onPress={onReset}
      >
        <Ionicons name="refresh" size={17} color="#94A3B8" />
      </Pressable>
    </Animated.View>
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

// Bottom controls bar
function BottomControlsBar({
  torch,
  onTorchToggle,
  onFlip,
}: {
  torch: boolean;
  onTorchToggle: () => void;
  onFlip: () => void;
}) {
  return (
    <View style={styles.shutterBar}>
      <Pressable style={styles.controlBtn} onPress={onTorchToggle}>
        <View
          style={[
            styles.controlThumb,
            torch && {
              backgroundColor: "rgba(242, 193, 78, 0.22)",
              borderColor: "#F2C14E",
            },
          ]}
        >
          <Ionicons
            name={torch ? "flashlight" : "flashlight-outline"}
            size={22}
            color={torch ? "#F2C14E" : "#E8F0FE"}
          />
        </View>
      </Pressable>
      <View style={styles.scanTargetBadge}>
        <View style={styles.pulseDot} />
        <Text style={styles.scanTargetText}>AUTO SCANNING</Text>
      </View>
      <Pressable style={styles.controlBtn} onPress={onFlip}>
        <View style={styles.controlThumb}>
          <Ionicons name="camera-reverse-outline" size={22} color="#E8F0FE" />
        </View>
      </Pressable>
    </View>
  );
}

// Main App
export default function App() {
  const [setupState, setSetupState] = useState<SetupState>("checking");
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const [targetDistance, setTargetDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
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
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [facing, setFacing] = useState<"front" | "back">("back");

  // Interactive model scale & rotation state for screen gestures
  const [modelScale, setModelScale] = useState<number>(0.2);
  const [modelRotation, setModelRotation] = useState<[number, number, number]>([0, 0, 0]);

  // Stable persistent refs for ultra-smooth 60fps gesture tracking
  const currentScaleRef = useRef<number>(0.2);
  const currentRotationRef = useRef<[number, number, number]>([0, 0, 0]);
  const startScaleRef = useRef<number>(0.2);
  const startRotationRef = useRef<[number, number, number]>([0, 0, 0]);
  const startTouchPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const startPinchDistRef = useRef<number | null>(null);

  useEffect(() => {
    if (content) {
      const s = content.scale || 0.2;
      setModelScale(s);
      setModelRotation([0, 0, 0]);
      currentScaleRef.current = s;
      currentRotationRef.current = [0, 0, 0];
      startScaleRef.current = s;
      startRotationRef.current = [0, 0, 0];
      startPinchDistRef.current = null;
    }
  }, [content?.id, content?.scale]);

  // PanResponder is created once with persistent refs — zero re-binding overhead
  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          // 2-finger pinch initiated
          const t1 = touches[0];
          const t2 = touches[1];
          startPinchDistRef.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          startScaleRef.current = currentScaleRef.current;
        } else if (touches && touches.length === 1) {
          // 1-finger swipe initiated
          startTouchPosRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          startRotationRef.current = [...currentRotationRef.current] as [number, number, number];
          startPinchDistRef.current = null;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          // 2-FINGER PINCH: Instant smooth camera-style zoom
          const t1 = touches[0];
          const t2 = touches[1];
          const currentDist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          if (startPinchDistRef.current && startPinchDistRef.current > 10) {
            const factor = currentDist / startPinchDistRef.current;
            const newScale = Math.max(0.005, Math.min(25.0, startScaleRef.current * factor));
            currentScaleRef.current = newScale;
            setModelScale(newScale);
          }
        } else if (touches && touches.length === 1 && !startPinchDistRef.current) {
          // 1-FINGER SWIPE: Ultra-smooth 360 rotation (left/right) & tilt (up/down)
          const currentX = touches[0].pageX;
          const currentY = touches[0].pageY;
          const deltaX = currentX - startTouchPosRef.current.x;
          const deltaY = currentY - startTouchPosRef.current.y;

          const newRotY = startRotationRef.current[1] - deltaX * 0.55;
          const newRotX = Math.max(-85, Math.min(85, startRotationRef.current[0] + deltaY * 0.45));

          currentRotationRef.current = [newRotX, newRotY, 0];
          setModelRotation([newRotX, newRotY, 0]);
        }
      },
      onPanResponderRelease: () => {
        startScaleRef.current = currentScaleRef.current;
        startRotationRef.current = [...currentRotationRef.current] as [number, number, number];
        startPinchDistRef.current = null;
      },
      onPanResponderTerminate: () => {
        startScaleRef.current = currentScaleRef.current;
        startRotationRef.current = [...currentRotationRef.current] as [number, number, number];
        startPinchDistRef.current = null;
      },
    });
  }, []);

  const handleZoomIn = () => {
    const next = Math.min(25.0, currentScaleRef.current * 1.3);
    currentScaleRef.current = next;
    startScaleRef.current = next;
    setModelScale(next);
  };

  const handleZoomOut = () => {
    const next = Math.max(0.005, currentScaleRef.current * 0.75);
    currentScaleRef.current = next;
    startScaleRef.current = next;
    setModelScale(next);
  };

  const handleResetOrientation = () => {
    const s = content?.scale || 0.2;
    currentScaleRef.current = s;
    startScaleRef.current = s;
    currentRotationRef.current = [0, 0, 0];
    startRotationRef.current = [0, 0, 0];
    setModelScale(s);
    setModelRotation([0, 0, 0]);
  };

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


  async function startNavigation(targetContent: MuralContent) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDetail("Location permission required for AR discovery.");
        setSetupState("permission-denied");
        return;
      }
      
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        (loc) => {
          setCurrentLocation(loc);
        }
      );

      headingSubRef.current = await Location.watchHeadingAsync((head) => {
        setCurrentHeading(head.magHeading);
      });
    } catch (e) {
      console.warn(e);
      setSetupState("error");
    }
  }

  useEffect(() => {
    if (setupState === "navigating" && content?.latitude && content?.longitude && currentLocation) {
      const lat1 = currentLocation.coords.latitude;
      const lon1 = currentLocation.coords.longitude;
      const lat2 = content.latitude;
      const lon2 = content.longitude;

      const R = 6371e3;
      const phi1 = lat1 * Math.PI/180;
      const phi2 = lat2 * Math.PI/180;
      const deltaphi = (lat2-lat1) * Math.PI/180;
      const deltalambda = (lon2-lon1) * Math.PI/180;

      const a = Math.sin(deltaphi/2) * Math.sin(deltaphi/2) +
                Math.cos(phi1) * Math.cos(phi2) *
                Math.sin(deltalambda/2) * Math.sin(deltalambda/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const dist = R * c;

      const y = Math.sin(deltalambda) * Math.cos(phi2);
      const x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(deltalambda);
      const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

      setTargetDistance(dist);
      setTargetBearing(brng);

      const triggerRadius = content.radius ?? 5;
      if (dist <= triggerRadius && !isTransitioning) {
        setDetail(`Loading ${content.name}`);
        setSetupState("ready");
        if (locationSubRef.current) { locationSubRef.current.remove(); locationSubRef.current = null; }
        if (headingSubRef.current) { headingSubRef.current.remove(); headingSubRef.current = null; }
      }
    }
  }, [currentLocation, setupState, content, isTransitioning]);

  function resolveContent(contentId: string, choice?: ContentChoice, dynamicContent?: MuralContent) {
    const manifestEntry = dynamicContent ?? choice?.dynamicContent ?? contentManifest[contentId];
    setSelectedChoice(choice ?? null);
    if (!manifestEntry) {
      setMissingContentId(contentId);
      setContent(null);
      setSetupState("checking");
      setDetail("Content coming soon");
      return;
    }
    if (manifestEntry.latitude !== undefined && manifestEntry.longitude !== undefined) {
      setContent(manifestEntry);
      setSetupState("navigating");
      setDetail(`Navigating to ${manifestEntry.name}`);
      startNavigation(manifestEntry);
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
    // Tear down the AR scene gracefully before unmounting ViroARSceneNavigator
    if (locationSubRef.current) { locationSubRef.current.remove(); locationSubRef.current = null; }
    if (headingSubRef.current) { headingSubRef.current.remove(); headingSubRef.current = null; }
    setCurrentLocation(null);
    setCurrentHeading(null);
    setTargetDistance(null);
    setTargetBearing(null);
    setIsTransitioning(true);
    setContent(null);
    setIsTrackingAnchor(false);
    setIsModelPlaced(false);

    // Give Viro native layer time to release resources before full reset
    setTimeout(() => {
      setQrPayload(null);
      setChoices([]);
      setSelectedChoice(null);
      setMissingContentId(null);
      setScannerLocked(false);
      setIsTransitioning(false);
      setSetupState("checking");
      setDetail("Scan a QR code to start AR");
    }, 350);
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
    resolveContent(parsedPayload.qrId, undefined, parsedPayload.dynamicContent);
  }

  function handleChoiceSelected(choice: ContentChoice) {
    resolveContent(choice.contentId, choice, choice.dynamicContent);
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
          <ActivityIndicator color="#3B82F6" size="large" style={{ marginTop: 24 }} />
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
          enableTorch={torch}
          zoom={zoom}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={!scannerLocked ? handleQrScanned : undefined}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={styles.cameraUI} pointerEvents="box-none">
          <TopControlsBar />
          <View style={styles.viewfinder} pointerEvents="none">
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cTL]} />
              <View style={[styles.corner, styles.cTR]} />
              <View style={[styles.corner, styles.cBL]} />
              <View style={[styles.corner, styles.cBR]} />
              <ScanLine locked={scannerLocked} />
              <Text style={styles.scanHintText}>Align QR code within frame</Text>
            </View>
          </View>
          <ZoomSelector currentZoom={zoom} onZoomChange={setZoom} />
          <BottomControlsBar
            torch={torch}
            onTorchToggle={() => setTorch((t) => !t)}
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
                <Ionicons name="chevron-forward" size={20} color="#3B82F6" />
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

  // Navigation View
  if (setupState === "navigating") {
    let arrowRotation = 0;
    if (currentHeading !== null && targetBearing !== null) {
      arrowRotation = targetBearing - currentHeading;
    }
    
    return (
      <View style={styles.cameraRoot}>
        <CameraView facing="back" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ color: '#1EC8A5', fontSize: 32, fontWeight: '900', marginBottom: 40, textAlign: 'center' }}>
            {targetDistance !== null ? `${Math.round(targetDistance)}m\nTO DESTINATION` : "CALCULATING\nROUTE..."}
          </Text>
          <View style={{ width: 220, height: 220, borderRadius: 110, borderWidth: 4, borderColor: '#1EC8A5', justifyContent: 'center', alignItems: 'center', backgroundColor: '#050D0C' }}>
            {targetBearing !== null && currentHeading !== null ? (
              <Ionicons 
                name="navigate" 
                size={100} 
                color="#3B82F6" 
                style={{ transform: [{ rotate: `${arrowRotation - 45}deg` }] }}
              />
            ) : (
              <ActivityIndicator color="#3B82F6" size="large" />
            )}
          </View>
          <Text style={{ color: '#fff', fontSize: 16, marginTop: 40, textAlign: 'center', paddingHorizontal: 40, lineHeight: 24, opacity: 0.8 }}>
            Follow the compass to your destination. AR discovery will trigger automatically when you are within {content?.radius ?? 5} meters.
          </Text>
          
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed, { marginTop: 40 }]}
            onPress={resetScan}
          >
            <Text style={styles.ghostBtnText}>Cancel Navigation</Text>
          </Pressable>
        </View>
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
            <ActivityIndicator color="#3B82F6" size="large" style={{ marginTop: 24 }} />
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
  const trackingStatus = isModelPlaced ? "PLACED" : "SCAN SURFACE";

  const statusColor = isModelPlaced
    ? "#3B82F6"
    : "#F2C14E";

  const arHint = isModelPlaced
    ? "Swipe 1 finger to rotate. Pinch anywhere to zoom."
    : "Point camera at the floor/surface and tap the grid to place.";

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
          userScale: modelScale,
          userRotation: modelRotation,
        }}
      />
      {/* Full-screen gesture responder surface for smooth 1-finger swipe rotate and 2-finger pinch zoom */}
      <View style={StyleSheet.absoluteFillObject} {...panResponder.panHandlers} pointerEvents="box-only" />

      <SafeAreaView style={styles.arHudSafeArea} pointerEvents="box-none">
        <View style={styles.arTopBar}>
          <View style={styles.arTopCard}>
            {/* Left: back button */}
            <Pressable style={styles.arBackBtn} onPress={resetScan} pointerEvents="auto">
              <Ionicons name="chevron-back" size={18} color="#3B82F6" />
              <Text style={styles.arBackText}>Camera</Text>
            </Pressable>

            {/* Divider */}
            <View style={styles.arTopDivider} />

            {/* Center: title + subtitle */}
            <View style={styles.arContentInfo}>
              <Text style={styles.arContentName} numberOfLines={1}>{content.name}</Text>
              <Text style={styles.arContentSub}>Spatial View</Text>
            </View>

            {/* Divider */}
            <View style={styles.arTopDivider} />

            {/* Right: live status badge */}
            <View style={styles.arStatusBadge}>
              <View style={[styles.arStatusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.arStatusText, { color: statusColor }]}>{trackingStatus}</Text>
            </View>
          </View>
        </View>
        <FloatingHintBubble text={arHint} />

        {/* Floating Quick Zoom & Reset controls (fades in after 6 seconds) */}
        <FloatingSideControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onReset={handleResetOrientation}
        />

        <View style={styles.arBottomBar}>
          <View style={{ width: 48 }} />
          <View style={styles.arShutterOuter}>
            <View style={styles.arShutterInner}>
              <Text style={styles.arShutterIcon}>AR</Text>
            </View>
          </View>
          <View style={{ width: 48 }} />
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
    backgroundColor: "#020814",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  splashCard: {
    alignItems: "center",
    backgroundColor: "#0A1526",
    borderColor: "#1EC8A520",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 360,
    padding: 36,
    width: "100%",
  },
  splashLogo: {
    alignItems: "center",
    backgroundColor: "#0E1F3B",
    borderColor: "#1EC8A530",
    borderRadius: 16,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  splashLogoText: {
    color: "#3B82F6",
    fontSize: 26,
    fontWeight: "900",
  },
  splashTitle: {
    color: "#E8F0FE",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 20,
    textAlign: "center",
  },
  splashSub: {
    color: "#8AB4F8",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    marginTop: 22,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  primaryBtnText: {
    color: "#020814",
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
    justifyContent: "center",
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: (RNStatusBar.currentHeight ?? 24) + 8,
  },
  appNameBadge: {
    alignItems: "center",
    justifyContent: "center",
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
    borderColor: "#3B82F6",
    height: 40,
    position: "absolute",
    width: 40,
  },
  cTL: { borderLeftWidth: 4, borderTopWidth: 4, left: 0, top: 0, borderTopLeftRadius: 6 },
  cTR: { borderRightWidth: 4, borderTopWidth: 4, right: 0, top: 0, borderTopRightRadius: 6 },
  cBL: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0, borderBottomLeftRadius: 6 },
  cBR: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0, borderBottomRightRadius: 6 },
  scanLine: {
    backgroundColor: "#3B82F6",
    height: 2,
    left: 12,
    position: "absolute",
    right: 12,
    shadowColor: "#3B82F6",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
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
    paddingBottom: Platform.OS === "android" ? 44 : 20,
    paddingHorizontal: 32,
  },
  pulseDot: {
    backgroundColor: "#3B82F6",
    borderRadius: 4,
    height: 7,
    marginRight: 7,
    width: 7,
  },
  scanTargetBadge: {
    alignItems: "center",
    backgroundColor: "rgba(30, 200, 165, 0.15)",
    borderColor: "rgba(30, 200, 165, 0.4)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  scanTargetText: {
    color: "#3B82F6",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  controlBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 64,
  },
  controlThumb: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  choiceRoot: {
    backgroundColor: "#020814",
    flex: 1,
  },
  choiceSafeArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === "android" ? 40 : 20,
  },
  choiceHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 8,
  },
  choiceEyebrow: {
    color: "#3B82F6",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  choiceTitle: {
    color: "#E8F0FE",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 2,
  },
  choiceSubtitle: {
    color: "#8AB4F8",
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
    backgroundColor: "#0A1526",
    borderColor: "#1EC8A520",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  choiceCardPressed: {
    backgroundColor: "#122A50",
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
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "900",
  },
  choiceCardLabel: {
    color: "#E8F0FE",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  choiceCardSub: {
    color: "#8AB4F8",
    fontSize: 12,
    marginTop: 2,
  },
  choiceCardArrow: {
    color: "#3B82F6",
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
    color: "#8AB4F8",
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
    backgroundColor: "transparent",
    flexDirection: "row",
    justifyContent: "center",
    paddingBottom: 10,
    paddingHorizontal: 14,
    paddingTop: (RNStatusBar.currentHeight ?? 24) + 10,
  },
  arTopCard: {
    alignItems: "center",
    backgroundColor: "rgba(6, 18, 16, 0.72)",
    borderColor: "rgba(30, 200, 165, 0.22)",
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    flex: 1,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  arBackBtn: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  arBackText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 2,
  },
  arTopDivider: {
    backgroundColor: "rgba(30, 200, 165, 0.2)",
    height: 28,
    width: 1,
  },
  arContentInfo: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  arContentName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  arContentSub: {
    color: "rgba(138,180,248,0.75)",
    fontSize: 10,
    marginTop: 1,
    textAlign: "center",
  },
  arStatusBadge: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  arStatusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  arStatusText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  arHintBubbleWrap: {
    alignItems: "center",
    padding: 16,
  },
  arHintBubble: {
    backgroundColor: "rgba(2,8,20,0.78)",
    borderColor: "rgba(59,130,246,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 320,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  arHintText: {
    color: "#D0E2FF",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
  arBottomBar: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderTopWidth: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: Platform.OS === "android" ? 48 : 24,
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
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "800",
  },
  arShutterOuter: {
    alignItems: "center",
    borderColor: "#3B82F6",
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
    color: "#3B82F6",
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
  arSideControls: {
    alignItems: "center",
    backgroundColor: "rgba(6, 18, 16, 0.72)",
    borderColor: "rgba(30, 200, 165, 0.22)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 4,
    position: "absolute",
    right: 16,
    top: "42%",
  },
  arSideBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
});
