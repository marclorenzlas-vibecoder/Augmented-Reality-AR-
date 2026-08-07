export type ContentChoice = {
  id: string;
  label: string;
  contentId: string;
};

export type MuralContent = {
  id: string;
  name: string;
  description: string;
  assetUrl?: string;
  assetUrlAndroid?: string;
  assetType: "GLB" | "GLTF" | "placeholder";
  scale: number;
  loop: boolean;
  trackingTargetName?: string;
};

export const contentManifest: Record<string, MuralContent> = {
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
