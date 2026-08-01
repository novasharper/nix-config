// Normalize unknown failures at module boundaries.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
