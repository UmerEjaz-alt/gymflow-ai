export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WHATSAPP_IMAGE_ACCEPT = "image/jpeg,image/png";
export const WHATSAPP_IMAGE_ERROR = "Use a JPG or PNG image up to 5 MB for WhatsApp.";

type WhatsAppImageType = {
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
};

type FileMetadata = Pick<File, "name" | "size" | "type">;

const JPEG_EXTENSIONS = new Set(["jpg", "jpeg"]);
const PNG_EXTENSIONS = new Set(["png"]);

function extensionOf(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function validateWhatsAppImageMetadata(file: FileMetadata): string | null {
  if (
    !["image/jpeg", "image/png"].includes(file.type) ||
    file.size <= 0 ||
    file.size > WHATSAPP_IMAGE_MAX_BYTES
  ) {
    return WHATSAPP_IMAGE_ERROR;
  }

  const extension = extensionOf(file.name);
  if (
    (file.type === "image/jpeg" && !JPEG_EXTENSIONS.has(extension)) ||
    (file.type === "image/png" && !PNG_EXTENSIONS.has(extension))
  ) {
    return WHATSAPP_IMAGE_ERROR;
  }

  return null;
}

/**
 * Authoritative upload validation. File.type and the extension are both
 * client-controlled, so the server also verifies the file's binary signature.
 */
export async function validateWhatsAppImageUpload(
  file: File,
): Promise<{ data: WhatsAppImageType; error: null } | { data: null; error: string }> {
  const metadataError = validateWhatsAppImageMetadata(file);
  if (metadataError) return { data: null, error: metadataError };

  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isJpeg =
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (file.type === "image/jpeg" && isJpeg) {
    return { data: { mimeType: "image/jpeg", extension: "jpg" }, error: null };
  }
  if (file.type === "image/png" && isPng) {
    return { data: { mimeType: "image/png", extension: "png" }, error: null };
  }

  return { data: null, error: WHATSAPP_IMAGE_ERROR };
}
