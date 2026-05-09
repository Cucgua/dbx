import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { uuid } from "@/lib/utils";

const STORAGE_KEY = "dbx-saved-sql-library";

export interface SavedSqlFolder {
  id: string;
  connectionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSqlFile {
  id: string;
  connectionId: string;
  folderId?: string;
  name: string;
  database: string;
  schema?: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedSqlState {
  folders: SavedSqlFolder[];
  files: SavedSqlFile[];
}

function nowIso() {
  return new Date().toISOString();
}

function loadState(): SavedSqlState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], files: [] };
    const parsed = JSON.parse(raw) as Partial<SavedSqlState>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((item) => item?.id && item?.connectionId) : [],
      files: Array.isArray(parsed.files) ? parsed.files.filter((item) => item?.id && item?.connectionId) : [],
    };
  } catch {
    return { folders: [], files: [] };
  }
}

export const useSavedSqlStore = defineStore("savedSql", () => {
  const initial = loadState();
  const folders = ref<SavedSqlFolder[]>(initial.folders);
  const files = ref<SavedSqlFile[]>(initial.files);

  const version = computed(
    () => `${folders.value.length}:${files.value.length}:${files.value.map((f) => f.updatedAt).join("|")}`,
  );

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ folders: folders.value, files: files.value }));
  }

  function listFolders(connectionId: string) {
    return folders.value
      .filter((folder) => folder.connectionId === connectionId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  function listFiles(connectionId: string, folderId?: string) {
    return files.value
      .filter((file) => file.connectionId === connectionId && (file.folderId || "") === (folderId || ""))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  function getFile(id: string) {
    return files.value.find((file) => file.id === id);
  }

  function createFolder(connectionId: string, name: string) {
    const timestamp = nowIso();
    const folder: SavedSqlFolder = {
      id: uuid(),
      connectionId,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    folders.value = [...folders.value, folder];
    persist();
    return folder;
  }

  function renameFolder(id: string, name: string) {
    const timestamp = nowIso();
    folders.value = folders.value.map((folder) =>
      folder.id === id ? { ...folder, name, updatedAt: timestamp } : folder,
    );
    persist();
  }

  function deleteFolder(id: string) {
    folders.value = folders.value.filter((folder) => folder.id !== id);
    files.value = files.value.filter((file) => file.folderId !== id);
    persist();
  }

  function saveFile(input: {
    id?: string;
    connectionId: string;
    folderId?: string;
    name: string;
    database: string;
    schema?: string;
    sql: string;
  }) {
    const timestamp = nowIso();
    if (input.id) {
      const existing = getFile(input.id);
      if (existing) {
        const updated: SavedSqlFile = {
          ...existing,
          folderId: input.folderId || undefined,
          name: input.name,
          database: input.database,
          schema: input.schema,
          sql: input.sql,
          updatedAt: timestamp,
        };
        files.value = files.value.map((file) => (file.id === input.id ? updated : file));
        persist();
        return updated;
      }
    }

    const file: SavedSqlFile = {
      id: uuid(),
      connectionId: input.connectionId,
      folderId: input.folderId || undefined,
      name: input.name,
      database: input.database,
      schema: input.schema,
      sql: input.sql,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    files.value = [...files.value, file];
    persist();
    return file;
  }

  function renameFile(id: string, name: string) {
    const timestamp = nowIso();
    files.value = files.value.map((file) => (file.id === id ? { ...file, name, updatedAt: timestamp } : file));
    persist();
  }

  function deleteFile(id: string) {
    files.value = files.value.filter((file) => file.id !== id);
    persist();
  }

  return {
    folders,
    files,
    version,
    listFolders,
    listFiles,
    getFile,
    createFolder,
    renameFolder,
    deleteFolder,
    saveFile,
    renameFile,
    deleteFile,
  };
});
