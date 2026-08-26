const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

export function resolveMediaUrl(fileUrl: string): string {
  const value = fileUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    // LocalDiskStorageService files belong to the active API deployment. Old
    // absolute LAN/localhost origins become stale whenever the API host changes.
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${API_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return value;
  }
  return `${API_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`;
}
