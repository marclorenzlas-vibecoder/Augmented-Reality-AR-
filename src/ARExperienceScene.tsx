import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image } from "react-native";
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

// ---------- 3D Model Content (memoized to prevent reloads) ----------

const ManifestContent = React.memo(function ManifestContent({ content }: { content: MuralContent }) {
  const [loadError, setLoadError] = useState(false);

  const source = useMemo(() => {
    const androidAssetUrl = content.assetUrlAndroid ?? content.assetUrl;
    const rawSource = content.localAsset
      ? content.localAsset
      : androidAssetUrl
        ? { uri: androidAssetUrl }
        : null;

    return typeof rawSource === "number"
      ? Image.resolveAssetSource(rawSource)
      : rawSource;
  }, [content.id, content.localAsset, content.assetUrl, content.assetUrlAndroid]);

  if (content.assetType !== "placeholder" && source && !loadError) {
    return (
      <Viro3DObject
        position={[0, 0, 0]}
        source={source}
        type={content.assetType}
        onError={(event) => {
          console.warn("Error loading 3D model asset:", event?.nativeEvent);
          setLoadError(true);
        }}
      />
    );
  }

  return <PlaceholderContent />;
});

// ---------- Interactive Container (drag, rotate, pinch) ----------

function InteractiveContainer({ content, children }: { content: MuralContent; children: React.ReactNode }) {
  const [scale, setScale] = useState<[number, number, number]>([content.scale, content.scale, content.scale]);
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0]);

  const currentScaleRef = useRef<number>(content.scale);
  const baseScaleRef = useRef<number>(content.scale);
  const currentRotationYRef = useRef<number>(0);
  const baseRotationYRef = useRef<number>(0);

  useEffect(() => {
    setScale([content.scale, content.scale, content.scale]);
    setRotation([0, 0, 0]);
    currentScaleRef.current = content.scale;
    baseScaleRef.current = content.scale;
    currentRotationYRef.current = 0;
    baseRotationYRef.current = 0;
  }, [content.id, content.scale]);

  // Two-finger pinch to scale
  const handlePinch = (pinchState: number, scaleFactor: number) => {
    if (pinchState === 1) {
      baseScaleRef.current = currentScaleRef.current;
    } else if (pinchState === 2) {
      const nextScale = Math.max(0.005, Math.min(20.0, baseScaleRef.current * scaleFactor));
      currentScaleRef.current = nextScale;
      setScale([nextScale, nextScale, nextScale]);
    }
  };

  // Two-finger rotate to spin left/right
  const handleRotate = (rotateState: number, rotationFactor: number) => {
    if (rotateState === 1) {
      baseRotationYRef.current = currentRotationYRef.current;
    } else if (rotateState === 2) {
      const nextRotY = baseRotationYRef.current - rotationFactor;
      currentRotationYRef.current = nextRotY;
      setRotation([0, nextRotY, 0]);
    }
  };

  return (
    <ViroNode
      rotation={rotation}
      scale={scale}
      dragType="FixedToPlane"
      dragPlane={{ planePoint: [0, 0, 0], planeNormal: [0, 1, 0], maxDistance: 20 }}
      onRotate={handleRotate}
      onPinch={handlePinch}
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

  function handlePlaneSelected() {
    setTracking(true);
    setInternalPlaced(true);
    onPlacementStateChange?.(true);
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
          <InteractiveContainer content={content}>
            <ManifestContent content={content} />
          </InteractiveContainer>
        </ViroARImageMarker>
      ) : (
        // ---- Plane Selection Mode ----
        <ViroARPlaneSelector
          ref={selectorRef}
          alignment="Horizontal"
          minHeight={0.1}
          minWidth={0.1}
          onPlaneSelected={handlePlaneSelected}
          onPlaneRemoved={() => setTracking(false)}
        >
          {isPlaced ? (
            <InteractiveContainer content={content}>
              <ManifestContent content={content} />
            </InteractiveContainer>
          ) : (
            <PlacementReticle />
          )}
        </ViroARPlaneSelector>
      )}
    </ViroARScene>
  );
}
