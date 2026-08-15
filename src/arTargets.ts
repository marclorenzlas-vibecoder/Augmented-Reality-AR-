import { ImageSourcePropType, NativeModules, TurboModuleRegistry } from "react-native";
import { ViroARTrackingTargets } from "@reactvision/react-viro";

import { MuralContent } from "./contentManifest";

type RegisteredImageTarget = {
  targetName: string;
  source: ImageSourcePropType;
  physicalWidth: number;
};

const registeredImageTargets: Record<string, RegisteredImageTarget> = {
  // When the final printed QR image is available, add it like this:
  // mural_001: {
  //   targetName: "mural_001_qr",
  //   source: require("../assets/targets/mural_001_qr.png"),
  //   physicalWidth: 0.18,
  // },
};

let targetsRegistered = false;

export function getTrackingTarget(content: MuralContent) {
  return content.trackingTargetName
    ? Object.values(registeredImageTargets).find((target) => target.targetName === content.trackingTargetName)
    : registeredImageTargets[content.id];
}

export function registerTrackingTargets() {
  if (targetsRegistered) {
    return;
  }

  const targets = Object.fromEntries(
    Object.values(registeredImageTargets).map((target) => [
      target.targetName,
      {
        source: target.source,
        orientation: "Up",
        physicalWidth: target.physicalWidth,
      },
    ]),
  );

  if (Object.keys(targets).length > 0) {
    const trackingManager =
      NativeModules.VRTTrackingTargetManager ||
      NativeModules.VRTARTrackingTargetsModule ||
      (TurboModuleRegistry ? TurboModuleRegistry.get("VRTARTrackingTargetsModule") : null);

    if (trackingManager && ViroARTrackingTargets?.createTargets) {
      try {
        ViroARTrackingTargets.createTargets(targets);
      } catch (e) {
        console.warn("ViroARTrackingTargets initialization skipped:", e);
      }
    }
  }

  targetsRegistered = true;
}
