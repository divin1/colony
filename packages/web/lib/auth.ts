const STORAGE_KEY = "colony_api_key";

export class AuthError extends Error {
  constructor() {
    super("401 Unauthorized");
    this.name = "AuthError";
  }
}

export function isAuthError(err: unknown): boolean {
  return err instanceof AuthError || (err instanceof Error && err.message.startsWith("401"));
}

export function getStoredKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {}
}

export function clearKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
