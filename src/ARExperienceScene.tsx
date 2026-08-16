import React, { useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroAnimations,
  ViroARImageMarker,
  ViroARPlane,
  ViroARPlaneSelector,
  ViroARScene,
  ViroBox,
  ViroDirectionalLight,
  ViroMaterials,
  ViroNode,
  ViroQuad,
  ViroSphere,
  ViroVideo,
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

// ---------- Placement Reticle (shown before placing) ----------

function PlacementReticle() {
  return (
    <ViroNode>
      <ViroQuad
        position={[0, 0.005, 0]}
        rotation={[-90, 0, 0]}
        width={0.25}
        height={0.25}
        materials={["reticle"]}
      />
      <ViroSphere
        position={[0, 0.12, 0]}
        radius={0.04}
        materials={["markerBlue"]}
        animation={{ name: "idleSpin", run: true, loop: true }}
      />
    </ViroNode>
  );
}

// ---------- Placeholder Content ----------

function PlaceholderContent() {
  return (
    <ViroNode>
      <ViroBox position={[0, 0.08, 0]} scale={[0.24, 0.16, 0.24]} materials={["markerGreen"]} />
      <ViroSphere
        animation={{ name: "idleSpin", run: true, loop: true }}
        position={[0, 0.32, 0]}
        radius={0.11}
        materials={["markerBlue"]}
      />
    </ViroNode>
  );
}

// ---------- 3D Model Content – downloads remote GLB to cache first ----------

const ManifestContent = React.memo(function ManifestContent({ content }: { content: MuralContent }) {
  const [localUri, setLocalUri] = useState<string | number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
    setLocalUri(null);

    if (content.localAsset != null) {
      setLocalUri(content.localAsset as unknown as number);
      return;
    }

    const rawUrl = (content.assetUrlAndroid ?? content.assetUrl ?? "") as string;
    if (!rawUrl) return;

    if (content.assetType === "VIDEO") {
      setLocalUri(rawUrl);
      return;
    }

    const filename = rawUrl.split("?")[0].split("/").pop() ?? "model.glb";
    const destPath = `${FileSystem.cacheDirectory}ar_models/${filename}`;

    async function downloadAsset() {
      setDownloading(true);
      try {
        await FileSystem.makeDirectoryAsync(
          `${FileSystem.cacheDirectory}ar_models/`,
          { intermediates: true },
        );

        const info = await FileSystem.getInfoAsync(destPath);
        if (info.exists) {
          setLocalUri(destPath);
          setDownloading(false);
          return;
        }

        const result = await FileSystem.downloadAsync(rawUrl, destPath);
        if (result.status === 200) {
          setLocalUri(result.uri);
        } else {
          console.warn("Download failed, status:", result.status);
          setLoadError(true);
        }
      } catch (e) {
        console.warn("Failed to download AR asset:", e);
        setLoadError(true);
      } finally {
        setDownloading(false);
      }
    }

    downloadAsset();
  }, [content.id, content.localAsset, content.assetUrl, content.assetUrlAndroid]);

  if (downloading || (!localUri && !loadError)) {
    return null;
  }

  if (loadError || !localUri) {
    return <PlaceholderContent />;
  }

  const source =
    typeof localUri === "number"
      ? localUri
      : { uri: localUri };

  if (content.assetType === "VIDEO") {
    return (
      <ViroVideo
        source={source}
        loop={content.loop ?? true}
        paused={false}
        width={1.6}
        height={0.9}
        position={[0, 0.5, 0]}
        onError={(event) => {
          console.warn("Video load error:", event?.nativeEvent);
          setLoadError(true);
        }}
      />
    );
  }

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
        setLoadError(true);
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
  const selectorRef = useRef<ViroARPlaneSelector>(null);
  const [hasAnchor, setHasAnchor] = useState(false);
  const [internalPlaced, setInternalPlaced] = useState(false);

  const content = props?.sceneNavigator?.viroAppProps?.content;
  const trackingTarget = content ? getTrackingTarget(content) : undefined;
  const onTrackingChange = props?.sceneNavigator?.viroAppProps?.onTrackingChange;
  const externalPlaced = props?.sceneNavigator?.viroAppProps?.isPlaced;
  const onPlacementStateChange = props?.sceneNavigator?.viroAppProps?.onPlacementStateChange;
  const userScale = props?.sceneNavigator?.viroAppProps?.userScale;
  const userRotation = props?.sceneNavigator?.viroAppProps?.userRotation;
  const userPosition = props?.sceneNavigator?.viroAppProps?.userPosition;

  const isPlaced = externalPlaced ?? internalPlaced;

  useEffect(() => {
    registerTrackingTargets();
  }, []);

  useEffect(() => {
    setInternalPlaced(false);
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
      anchorDetectionTypes={trackingTarget ? ["Images"] : ["PlanesHorizontal"]}
      onAnchorFound={(anchor) => selectorRef.current?.handleAnchorFound(anchor)}
      onAnchorUpdated={(anchor) => selectorRef.current?.handleAnchorUpdated(anchor)}
      onAnchorRemoved={(anchor) => anchor && selectorRef.current?.handleAnchorRemoved(anchor)}
    >
      <ViroAmbientLight color="#ffffff" intensity={720} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.5]} />

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
      ) : (
        // ---- Instant AR World Placement Mode ----
        <ViroNode position={[0, -0.25, -1.0]}>
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
