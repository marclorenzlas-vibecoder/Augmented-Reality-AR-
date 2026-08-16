import { ContentChoice, MuralContent } from "./contentManifest";

export type QrPayload = {
  raw: string;
  qrId: string;
  choices: ContentChoice[];
  dynamicContent?: MuralContent;
};

function sanitizeId(value: string) {
  return value.trim().replace(/^#/, "");
}

function inferAssetType(url: string, explicitType?: string): "GLB" | "GLTF" | "VIDEO" | "placeholder" {
  if (explicitType) {
    const upper = explicitType.toUpperCase().trim();
    if (upper === "GLB") return "GLB";
    if (upper === "GLTF") return "GLTF";
    if (upper === "VIDEO" || upper === "MP4" || upper === "STREAM") return "VIDEO";
  }

  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".glb")) return "GLB";
  if (lower.endsWith(".gltf")) return "GLTF";
  if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m3u8") || lower.endsWith(".webm")) {
    return "VIDEO";
  }

  return "GLB";
}

function parseChoiceArray(value: unknown): ContentChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: ContentChoice[] = [];

  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (typeof item === "string") {
      const label = item.trim();
      const contentId = sanitizeId(label);
      if (label) {
        results.push({ id: `${index}-${contentId}`, label, contentId });
      }
      continue;
    }

    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : typeof record.name === "string" ? record.name.trim() : "";
      const rawUrl = typeof record.assetUrl === "string" ? record.assetUrl.trim() : typeof record.url === "string" ? record.url.trim() : "";
      const explicitType = typeof record.assetType === "string" ? record.assetType.trim() : typeof record.type === "string" ? record.type.trim() : undefined;
      const scale = typeof record.scale === "number" ? record.scale : 0.2;

      const contentId =
        typeof record.contentId === "string"
          ? sanitizeId(record.contentId)
          : typeof record.id === "string"
            ? sanitizeId(record.id)
            : typeof record.value === "string"
              ? sanitizeId(record.value)
              : sanitizeId(label || `choice_${index}`);

      let dynamicContent: MuralContent | undefined;
      if (rawUrl) {
        dynamicContent = {
          id: contentId || `online_${index}`,
          name: label || "Online AR Experience",
          description: "Loaded dynamically from online asset.",
          assetUrl: rawUrl,
          assetType: inferAssetType(rawUrl, explicitType),
          scale,
          loop: true,
        };
      }

      if (label || rawUrl) {
        results.push({
          id: `${index}-${contentId}`,
          label: label || "AR Experience",
          contentId,
          assetUrl: rawUrl || undefined,
          assetType: dynamicContent?.assetType,
          scale,
          dynamicContent,
        });
      }
    }
  }

  return results;
}

function parseDelimitedChoices(value: string | null): ContentChoice[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const [labelPart, idPart] = item.split(":");
      const label = labelPart.trim();
      const contentId = sanitizeId((idPart ?? label).trim());

      return { id: `${index}-${contentId}`, label, contentId };
    });
}

function getIdFromUrl(url: URL) {
  const queryId = url.searchParams.get("id") ?? url.searchParams.get("qr") ?? url.searchParams.get("mural");

  if (queryId) {
    return sanitizeId(queryId);
  }

  const lastPathSegment = url.pathname.split("/").filter(Boolean).pop();

  return lastPathSegment ? sanitizeId(lastPathSegment) : "";
}

export function parseQrPayload(data: string): QrPayload {
  const raw = data.trim();

  // Case 1: JSON payload
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const idValue = parsed.id ?? parsed.qr_id ?? parsed.mural_id ?? parsed.contentId;
    const qrId = typeof idValue === "string" ? sanitizeId(idValue) : "";
    const choices = parseChoiceArray(parsed.choices).concat(parseChoiceArray(parsed.options));

    const rawUrl = typeof parsed.assetUrl === "string" ? parsed.assetUrl.trim() : typeof parsed.url === "string" ? parsed.url.trim() : "";
    const explicitType = typeof parsed.assetType === "string" ? parsed.assetType.trim() : typeof parsed.type === "string" ? parsed.type.trim() : undefined;
    const scale = typeof parsed.scale === "number" ? parsed.scale : 0.2;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : typeof parsed.title === "string" ? parsed.title.trim() : "Online AR Asset";

    let dynamicContent: MuralContent | undefined;
    if (rawUrl) {
      dynamicContent = {
        id: qrId || "online_asset",
        name,
        description: typeof parsed.description === "string" ? parsed.description : "Loaded directly from online link.",
        assetUrl: rawUrl,
        assetType: inferAssetType(rawUrl, explicitType),
        scale,
        loop: true,
      };
    }

    return { raw, qrId: qrId || raw, choices, dynamicContent };
  } catch {
    // Plain IDs and URL QR payloads are expected
  }

  // Case 2: URL payload
  try {
    const url = new URL(raw);
    const choices = parseDelimitedChoices(url.searchParams.get("choices")).concat(
      parseDelimitedChoices(url.searchParams.get("options")),
    );

    // Direct online asset URL (e.g. https://.../model.glb or https://.../video.mp4)
    const lowerPath = url.pathname.toLowerCase();
    const isDirectAsset =
      lowerPath.endsWith(".glb") ||
      lowerPath.endsWith(".gltf") ||
      lowerPath.endsWith(".mp4") ||
      lowerPath.endsWith(".mov") ||
      lowerPath.endsWith(".m3u8") ||
      url.searchParams.has("glb") ||
      url.searchParams.has("video");

    let dynamicContent: MuralContent | undefined;
    if (isDirectAsset || choices.length === 0) {
      const assetUrl = url.searchParams.get("glb") || url.searchParams.get("video") || raw;
      const explicitType = url.searchParams.get("type") || (url.searchParams.has("video") ? "VIDEO" : undefined);
      const scaleParam = parseFloat(url.searchParams.get("scale") || "0.2");
      const name = url.searchParams.get("name") || url.searchParams.get("title") || "Online AR Asset";

      dynamicContent = {
        id: getIdFromUrl(url) || "online_url",
        name,
        description: "Loaded directly from online link.",
        assetUrl,
        assetType: inferAssetType(assetUrl, explicitType),
        scale: isNaN(scaleParam) ? 0.2 : scaleParam,
        loop: true,
      };
    }

    return { raw, qrId: getIdFromUrl(url) || raw, choices, dynamicContent };
  } catch {
    // Case 3: Plain text ID
    return { raw, qrId: sanitizeId(raw), choices: [] };
  }
}
