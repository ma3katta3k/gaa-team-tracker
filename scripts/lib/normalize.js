// Single source of truth for name normalization, shared by every importer.
// Must stay identical to how players.normalized_name is derived at insert
// time, or player matching silently breaks.
export function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

export function lastWord(normalizedName) {
  const parts = normalizedName.split(" ");
  return parts[parts.length - 1];
}
