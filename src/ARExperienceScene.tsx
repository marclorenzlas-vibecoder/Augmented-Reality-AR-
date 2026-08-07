import React, { useEffect, useRef, useState } from "react";
import {
  Viro3DObject,
  ViroAmbientLight,
  ViroAnimations,
  ViroARImageMarker,
  ViroARPlaneSelector,
  ViroARScene,
  ViroBox,
  ViroNode,
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
    };
  };
};

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

function PlaceholderContent({ scale }: { scale: number }) {
  return (
    <ViroNode animation={{ name: "contentEnter", run: true, loop: false }} scale={[scale, scale, scale]}>
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

function ManifestContent({ content }: { content: MuralContent }) {
  const androidAssetUrl = content.assetUrlAndroid ?? content.assetUrl;

  if (content.assetType !== "placeholder" && androidAssetUrl) {
    return (
      <Viro3DObject
        animation={{ name: "contentEnter", run: true, loop: false }}
        position={[0, 0, 0]}
        scale={[content.scale, content.scale, content.scale]}
        source={{ uri: androidAssetUrl }}
        type={content.assetType}
      />
    );
  }

  return <PlaceholderContent scale={content.scale} />;
}

export default function ARExperienceScene(props?: SceneNavigatorProps) {
  const selectorRef = useRef<ViroARPlaneSelector>(null);
  const [hasAnchor, setHasAnchor] = useState(false);
  const content = props?.sceneNavigator?.viroAppProps?.content;
  const trackingTarget = content ? getTrackingTarget(content) : undefined;
  const onTrackingChange = props?.sceneNavigator?.viroAppProps?.onTrackingChange;

  useEffect(() => {
    registerTrackingTargets();
  }, []);

  if (!content) {
    return <ViroARScene />;
  }

  function setTracking(isTracking: boolean) {
    setHasAnchor(isTracking);
    onTrackingChange?.(isTracking);
  }

  return (
    <ViroARScene
      anchorDetectionTypes={trackingTarget ? ["Images"] : ["PlanesHorizontal", "PlanesVertical"]}
      onAnchorFound={(anchor) => selectorRef.current?.handleAnchorFound(anchor)}
      onAnchorUpdated={(anchor) => selectorRef.current?.handleAnchorUpdated(anchor)}
      onAnchorRemoved={(anchor) => anchor && selectorRef.current?.handleAnchorRemoved(anchor)}
    >
      <ViroAmbientLight color="#ffffff" intensity={720} />

      {trackingTarget ? (
        <ViroARImageMarker
          target={trackingTarget.targetName}
          onAnchorFound={() => setTracking(true)}
          onAnchorRemoved={() => setTracking(false)}
          pauseUpdates={!hasAnchor}
        >
          <ManifestContent content={content} />
        </ViroARImageMarker>
      ) : (
        <ViroARPlaneSelector
          ref={selectorRef}
          alignment="Both"
          minHeight={0.15}
          minWidth={0.15}
          onPlaneSelected={() => setTracking(true)}
          onPlaneRemoved={() => setTracking(false)}
        >
          <ManifestContent content={content} />
        </ViroARPlaneSelector>
      )}
    </ViroARScene>
  );
}
