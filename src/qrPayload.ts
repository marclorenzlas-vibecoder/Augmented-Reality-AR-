import { ContentChoice } from "./contentManifest";

export type QrPayload = {
  raw: string;
  qrId: string;
  choices: ContentChoice[];
};

function sanitizeId(value: string) {
  return value.trim().replace(/^#/, "");
}

function parseChoiceArray(value: unknown): ContentChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (typeof item === "string") {
        const label = item.trim();
        const contentId = sanitizeId(label);

        return label ? { id: `${index}-${contentId}`, label, contentId } : null;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label.trim() : "";
        const contentId =
          typeof record.contentId === "string"
            ? sanitizeId(record.contentId)
            : typeof record.value === "string"
              ? sanitizeId(record.value)
              : sanitizeId(label);

        return label && contentId ? { id: `${index}-${contentId}`, label, contentId } : null;
      }

      return null;
    })
    .filter((choice): choice is ContentChoice => Boolean(choice));
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

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const idValue = parsed.id ?? parsed.qr_id ?? parsed.mural_id ?? parsed.contentId;
    const qrId = typeof idValue === "string" ? sanitizeId(idValue) : "";
    const choices = parseChoiceArray(parsed.choices).concat(parseChoiceArray(parsed.options));

    return { raw, qrId: qrId || raw, choices };
  } catch {
    // Plain IDs and URL QR payloads are both expected in the field.
  }

  try {
    const url = new URL(raw);
    const choices = parseDelimitedChoices(url.searchParams.get("choices")).concat(
      parseDelimitedChoices(url.searchParams.get("options")),
    );

    return { raw, qrId: getIdFromUrl(url) || raw, choices };
  } catch {
    return { raw, qrId: sanitizeId(raw), choices: [] };
  }
}
