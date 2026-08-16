import React, { useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroAnimations,
  ViroARImageMarker,
  ViroARScene,
  ViroBox,
  ViroDirectionalLight,
  ViroMaterials,
  ViroNode,
  ViroSphere,
  ViroVideo,
  ViroText,
} from "@reactvision/react-viro";

import { getTrackingTarget, registerTrackingTargets } from "./arTargets";
import { MuralContent } from "./contentManifest";

type SceneNavigatorProps = {
  sceneNavigator?: {
    viroAppProps?: {
      content: MuralContent;
      onTrackingChange?: (isTracking: boolean) => void;
      onAssetStateChange?: (state: string) => void;
      isPlaced?: boolean;
      onPlacementStateChange?: (isPlaced: boolean) => void;
      userScale?: number;
      userRotation?: [number, number, number];
      userPosition?: [number, number, number];
    };
  };
};

import { NativeModules, TurboModuleRegistry } from "react-native";

export function initViroAnimations() {
  const animManager =
    NativeModules.VRTAnimationManager ||
    (TurboModuleRegistry ? TurboModuleRegistry.get("VRTAnimationManager") : null);

  if (animManager && ViroAnimations?.registerAnimations) {
    try {
      ViroAnimations.registerAnimations({
        popEnter: [
          {
            properties: {
              scaleX: 1.08,
              scaleY: 1.08,
              scaleZ: 1.08,
              opacity: 1,
            },
            duration: 550,
            easing: "EaseOut",
          },
          {
            properties: {
              scaleX: 1.0,
              scaleY: 1.0,
              scaleZ: 1.0,
            },
            duration: 250,
            easing: "EaseInEaseOut",
          },
        ],
        contentEnter: {
          duration: 650,
          easing: "EaseOut",
          properties: {
            opacity: 1,
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
          },
        },
        idleSpin: {
          duration: 4200,
          easing: "Linear",
          properties: {
            rotateY: "+=360",
          },
        },
      });
    } catch (e) {
      console.warn("ViroAnimations initialization skipped:", e);
    }
  }
}

initViroAnimations();


// ---------- Placeholder Content ----------

function PlaceholderContent({ errorMsg }: { errorMsg?: string }) {
  return (
    <ViroNode>
      <ViroBox position={[0, 0.08, 0]} scale={[0.24, 0.16, 0.24]} materials={["markerGreen"]} />
      <ViroSphere
        animation={{ name: "idleSpin", run: true, loop: true }}
        position={[0, 0.32, 0]}
        radius={0.11}
        materials={["markerBlue"]}
      />
      {errorMsg ? (
        <ViroText
          text={errorMsg}
          position={[0, 0.5, 0]}
          scale={[0.3, 0.3, 0.3]}
          style={{ fontFamily: "Arial", fontSize: 18, color: "#ff0000" }}
        />
      ) : null}
    </ViroNode>
  );
}


// ---------- 3D Model Content – downloads remote GLB to cache first ----------
// NOTE: Viro3DObject CANNOT load remote https:// URLs directly.
// The file MUST be downloaded to a local file:// path first.

const ManifestContent = React.memo(function ManifestContent({ content }: { content: MuralContent }) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | false>(false);

  useEffect(() => {
    setLoadError(false);
    setLocalUri(null);
    setDownloading(false);
    setProgress(0);

    // If it's a bundled local asset, use it directly
    if (content.localAsset != null) {
      setLocalUri("__local__");
      return;
    }

    const rawUrl = ((content.assetUrlAndroid ?? content.assetUrl ?? "") as string).trim();
    if (!rawUrl) {
      setLoadError("No asset URL configured");
      return;
    }

    // Videos can be streamed — no need to download
    if (content.assetType === "VIDEO") {
      setLocalUri(rawUrl);
      return;
    }

    // 3D models must be downloaded to a local path
    const filename = rawUrl.split("?")[0].split("/").pop() ?? "model.glb";
    const cacheDir = `${FileSystem.cacheDirectory}ar_models/`;
    const destPath = `${cacheDir}${filename}`;

    async function downloadAsset() {
      setDownloading(true);
      try {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

        const info = await FileSystem.getInfoAsync(destPath);
        if (info.exists && (info as any).size > 0) {
          // Already cached — use it immediately
          setLocalUri(destPath);
          setDownloading(false);
          return;
        }

        // Download with progress tracking
        const downloadResumable = FileSystem.createDownloadResumable(
          rawUrl,
          destPath,
          {},
          (downloadProgress) => {
            const pct =
              downloadProgress.totalBytesExpectedToWrite > 0
                ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
                : 0;
            setProgress(Math.round(pct * 100));
          }
        );

        const result = await downloadResumable.downloadAsync();
        if (result && result.status === 200) {
          setLocalUri(result.uri);
        } else {
          setLoadError(`Download failed: HTTP ${result?.status ?? "unknown"}`);
        }
      } catch (e: any) {
        console.warn("Failed to download AR asset:", e);
        setLoadError(`Network Error: ${e?.message ?? String(e)}`);
      } finally {
        setDownloading(false);
      }
    }

    downloadAsset();
  }, [content.id, content.localAsset, content.assetUrl, content.assetUrlAndroid]);

  // Show progress while downloading
  if (downloading) {
    return (
      <ViroNode>
        <ViroText
          text={`Downloading… ${progress}%`}
          position={[0, 0.2, 0]}
          scale={[0.3, 0.3, 0.3]}
          style={{ fontFamily: "Arial", fontSize: 20, color: "#1EC8A5", textAlignVertical: "center", textAlign: "center" }}
        />
      </ViroNode>
    );
  }

  if (loadError) {
    return <PlaceholderContent errorMsg={typeof loadError === "string" ? loadError : undefined} />;
  }

  if (!localUri) {
    return null;
  }

  // --- VIDEO ---
  if (content.assetType === "VIDEO") {
    return (
      <ViroVideo
        source={{ uri: localUri }}
        loop={content.loop ?? true}
        paused={false}
        width={1.6}
        height={0.9}
        position={[0, 0.5, 0]}
        onError={(event) => {
          console.warn("Video load error:", event?.nativeEvent);
          setLoadError("Video Error: " + (event?.nativeEvent?.error || JSON.stringify(event?.nativeEvent) || "Unknown"));
        }}
      />
    );
  }

  // --- 3D MODEL ---
  const source =
    localUri === "__local__"
      ? (content.localAsset as any)
      : { uri: localUri }; // This is now a file:// URI after download

  return (
    <Viro3DObject
      position={[0, 0, 0]}
      source={source}
      type={content.assetType as "GLB" | "GLTF"}
      animation={
        content.animationName
          ? { name: content.animationName, run: true, loop: content.loop ?? true }
          : undefined
      }
      onError={(event) => {
        console.warn("3D model load error:", event?.nativeEvent);
        setLoadError(
          "Model Error: " +
            (event?.nativeEvent?.error ||
              JSON.stringify(event?.nativeEvent) ||
              "Unknown")
        );
      }}
    />
  );
});

// ---------- Interactive Container (responsive scale, rotation, drag) ----------

function InteractiveContainer({
  content,
  userScale,
  userRotation,
  userPosition,
  children,
}: {
  content: MuralContent;
  userScale?: number;
  userRotation?: [number, number, number];
  userPosition?: [number, number, number];
  children: React.ReactNode;
}) {
  const currentScaleValue = userScale ?? content.scale ?? 0.2;
  const currentScale: [number, number, number] = [currentScaleValue, currentScaleValue, currentScaleValue];
  const currentRotation: [number, number, number] = userRotation ?? [0, 0, 0];
  const currentPosition: [number, number, number] = userPosition ?? [0, 0, 0];

  return (
    <ViroNode
      position={currentPosition}
      rotation={currentRotation}
      scale={currentScale}
    >
      {children}
    </ViroNode>
  );
}

// ---------- Main AR Scene ----------

export default function ARExperienceScene(props?: SceneNavigatorProps) {
  const [hasAnchor, setHasAnchor] = useState(false);

  const content = props?.sceneNavigator?.viroAppProps?.content;
  const trackingTarget = content ? getTrackingTarget(content) : undefined;
  const onTrackingChange = props?.sceneNavigator?.viroAppProps?.onTrackingChange;
  const externalPlaced = props?.sceneNavigator?.viroAppProps?.isPlaced;
  const onPlacementStateChange = props?.sceneNavigator?.viroAppProps?.onPlacementStateChange;
  const userScale = props?.sceneNavigator?.viroAppProps?.userScale;
  const userRotation = props?.sceneNavigator?.viroAppProps?.userRotation;
  const userPosition = props?.sceneNavigator?.viroAppProps?.userPosition;


  useEffect(() => {
    registerTrackingTargets();
  }, []);

  useEffect(() => {
    onPlacementStateChange?.(false);
  }, [content?.id]);

  if (!content) {
    return <ViroARScene />;
  }

  function setTracking(isTracking: boolean) {
    setHasAnchor(isTracking);
    onTrackingChange?.(isTracking);
  }

  return (
    <ViroARScene
      anchorDetectionTypes={trackingTarget ? ["Images"] : []}
    >
      <ViroAmbientLight color="#ffffff" intensity={720} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.5]} />
      <ViroDirectionalLight color="#ffffff" direction={[0.5, -0.5, 0.5]} intensity={400} />

      {trackingTarget ? (
        // ---- QR Image Marker Mode ----
        <ViroARImageMarker
          target={trackingTarget.targetName}
          onAnchorFound={() => setTracking(true)}
          onAnchorRemoved={() => setTracking(false)}
          pauseUpdates={!hasAnchor}
        >
          <InteractiveContainer
            content={content}
            userScale={userScale}
            userRotation={userRotation}
            userPosition={userPosition}
          >
            <ManifestContent content={content} />
          </InteractiveContainer>
        </ViroARImageMarker>
      ) : content.latitude !== undefined && content.longitude !== undefined ? (
        // ---- Geo-Anchored Discovery Mode (Scenario A) ----
        <ViroNode position={[0, -0.25, -1.5]}>
          <InteractiveContainer
            content={content}
            userScale={userScale}
            userRotation={userRotation}
            userPosition={userPosition}
          >
            <ManifestContent content={content} />
          </InteractiveContainer>
        </ViroNode>
      ) : (
        // ---- Sandbox / Instant Placement Mode (Scenario B) ----
        // Model is placed directly in front of the user — no tap required
        <ViroNode position={[0, -0.4, -1.2]}>
          <InteractiveContainer
            content={content}
            userScale={userScale}
            userRotation={userRotation}
            userPosition={userPosition}
          >
            <ManifestContent content={content} />
          </InteractiveContainer>
        </ViroNode>
      )}
    </ViroARScene>
  );
}
