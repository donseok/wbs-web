/** RFC 5987 UTF-8 파일명을 우선하고, 없거나 깨졌으면 일반 filename/fallback을 사용한다. */
export function filenameFromContentDisposition(
  contentDisposition: string | null,
  fallback: string,
): string {
  if (!contentDisposition) return fallback

  const encoded = contentDisposition.match(/filename\*\s*=\s*UTF-8''("[^"]+"|[^;]+)/i)?.[1]
  if (encoded) {
    const value = encoded.trim().replace(/^"|"$/g, '')
    try {
      return decodeURIComponent(value)
    } catch {
      // 일반 filename으로 폴백한다.
    }
  }

  const plain = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
  return (plain?.[1] ?? plain?.[2])?.trim() || fallback
}
