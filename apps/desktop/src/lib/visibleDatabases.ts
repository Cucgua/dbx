export function visibleDatabaseFilterIsEnabled(visibleDatabases: string[] | undefined): boolean {
  return Array.isArray(visibleDatabases);
}

export function filterVisibleDatabaseNames(databaseNames: string[], visibleDatabases: string[] | undefined): string[] {
  if (!visibleDatabaseFilterIsEnabled(visibleDatabases)) return databaseNames;
  const visible = new Set(visibleDatabases);
  return databaseNames.filter((name) => visible.has(name));
}

export function normalizeVisibleDatabaseSelection(selectedNames: string[], databaseNames: string[]): string[] {
  const available = new Set(databaseNames);
  const seen = new Set<string>();
  return selectedNames.filter((name) => {
    if (!available.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
