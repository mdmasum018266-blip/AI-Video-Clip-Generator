export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

export function getApiOrigin(): string | null {
  if (!API_BASE_URL) return null;
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return null;
  }
}
