/**
 * Build headers that make a browser save the response as a file.
 *
 * Client names are usually Hebrew, so the filename needs RFC 5987 encoding; a
 * plain ASCII fallback is kept for older clients that ignore `filename*`.
 */
export function attachmentHeaders(contentType: string, filename: string): Record<string, string> {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  };
}
