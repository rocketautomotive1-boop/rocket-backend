/**
 * Detecta tipo MIME e extensão pelos magic bytes do buffer.
 * Ignora qualquer pista do filename — confia apenas no conteúdo binário real.
 *
 * Usar antes de fazer upload pra S3, montar multipart pra APIs externas,
 * ou qualquer lugar onde Content-Type precisa bater com o conteúdo.
 */
export interface DetectedImageType {
    mime: string;
    ext: string;
}

const UNKNOWN: DetectedImageType = { mime: 'application/octet-stream', ext: 'bin' };

export function detectImageMimeType(buffer: Buffer): DetectedImageType {
    if (!buffer || buffer.length < 4) return UNKNOWN;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
    }
    // WEBP: "RIFF" ... "WEBP"
    if (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
        return { mime: 'image/webp', ext: 'webp' };
    }
    // GIF: "GIF8"
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return { mime: 'image/gif', ext: 'gif' };
    }

    return UNKNOWN;
}

export function isSupportedImage(buffer: Buffer): boolean {
    return detectImageMimeType(buffer).mime !== UNKNOWN.mime;
}
