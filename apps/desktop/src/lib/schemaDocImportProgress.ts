import type { SchemaRagApiDocExtraction } from "@/lib/schemaRag";
import type { ApiDocExtractionRequest } from "@/lib/schemaDocIngestion";

export const SCHEMA_DOC_IMPORT_LOG_LIMIT = 50;

export type SchemaDocImportStage =
  | "idle"
  | "selecting"
  | "reading"
  | "splitting"
  | "extracting"
  | "importing"
  | "refreshing"
  | "finished"
  | "failed";

export interface SchemaDocImportProgressState {
  stage: SchemaDocImportStage;
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  currentSections: number;
  apiFields: number;
  businessConcepts: number;
  joinCandidates: number;
  failedFiles: number;
  logs: string[];
}

export function createSchemaDocImportProgress(): SchemaDocImportProgressState {
  return {
    stage: "idle",
    totalFiles: 0,
    processedFiles: 0,
    currentFile: "",
    currentSections: 0,
    apiFields: 0,
    businessConcepts: 0,
    joinCandidates: 0,
    failedFiles: 0,
    logs: [],
  };
}

export function schemaDocImportProgressPercent(progress: SchemaDocImportProgressState): number {
  if (progress.stage === "finished") return 100;
  if (!progress.totalFiles || progress.totalFiles <= 0) return 0;
  const percent = Math.round((progress.processedFiles / progress.totalFiles) * 100);
  return Math.min(100, Math.max(0, percent));
}

export function appendSchemaDocImportLog(
  progress: SchemaDocImportProgressState,
  message: string,
  limit = SCHEMA_DOC_IMPORT_LOG_LIMIT,
): SchemaDocImportProgressState {
  const trimmed = message.trim();
  if (!trimmed) return progress;
  return {
    ...progress,
    logs: [...progress.logs, trimmed].slice(-Math.max(1, limit)),
  };
}

export function summarizeApiDocExtraction(extraction: SchemaRagApiDocExtraction) {
  return {
    apiFields: extraction.apiFields.length,
    businessConcepts: extraction.businessConcepts.length,
    joinCandidates: extraction.joinCandidates.length,
    failed: extraction.status === "failed",
  };
}

export function apiDocExtractionRequestSectionCount(request: ApiDocExtractionRequest): number {
  return request.sections.length;
}
