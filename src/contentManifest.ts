export type ContentChoice = {
  id: string;
  label: string;
  contentId: string;
  assetUrl?: string;
  assetType?: "GLB" | "GLTF" | "VIDEO" | "placeholder";
  scale?: number;
  dynamicContent?: MuralContent;
};

export type MuralContent = {
  id: string;
  name: string;
  description: string;
  assetUrl?: string;
  assetUrlAndroid?: string;
  localAsset?: any;
  assetType: "GLB" | "GLTF" | "VIDEO" | "placeholder";
  scale: number;
  loop: boolean;
  trackingTargetName?: string;
  animationName?: string;
  effectType?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  radius?: number;
  heading?: number;
};

export const contentManifest: Record<string, MuralContent> = {
  testcar: {
    id: "testcar",
    name: "Mazda RX-77",
    description: "3D Mazda RX-77 local model loaded directly from app assets.",
    assetType: "GLB",
    localAsset: require("../assets/models/Mazda RX-77.glb"),
    scale: 0.2,
    loop: true,
  },
  mural_001: {
    id: "mural_001",
    name: "Maskara Dance - Bacolod Plaza",
    description: "A placeholder Maskara-inspired AR performance for mural testing.",
    assetType: "placeholder",
    scale: 1,
    loop: true,
  },
  mural_002: {
    id: "mural_002",
    name: "Bacolod Heritage Story",
    description: "A second demo entry for testing multi-mural QR routing.",
    assetType: "placeholder",
    scale: 0.9,
    loop: true,
  },
};

export const defaultContentChoices: ContentChoice[] = [
  {
    id: "maskara",
    label: "Maskara Dance",
    contentId: "mural_001",
  },
  {
    id: "heritage",
    label: "Heritage Story",
    contentId: "mural_002",
  },
];
