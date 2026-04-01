import { Db, ObjectId } from "mongodb";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export interface LogEntryInput {
    level: LogLevel;
    message: string;
    service: string;
    environment: string;
    component?: string;
    operation?: string;
    status?: string;
    traceId?: string;
    requestId?: string;
    correlationId?: string;
    userId?: string;
    sessionId?: string;
    errorCode?: string;
    errorName?: string;
    stack?: string;
    context?: Record<string, unknown>;
}
export declare class Logger {
    private static readonly COLLECTION_NAME;
    private static readonly MAX_MESSAGE_LENGTH;
    private static readonly MAX_FIELD_LENGTH;
    private static readonly MAX_STACK_LENGTH;
    private static readonly MAX_CONTEXT_DEPTH;
    private static readonly MAX_OBJECT_KEYS;
    private static readonly MAX_ARRAY_LENGTH;
    private static readonly REDACTED_VALUE;
    private static readonly SENSITIVE_KEY_PATTERN;
    private constructor();
    static write(db: Db, input: LogEntryInput): Promise<ObjectId>;
    static ensureIndexes(db: Db): Promise<void>;
    private static buildDocument;
    private static validateInput;
    private static assertDb;
    private static sanitizeContext;
    private static sanitizeUnknown;
    private static sanitizeField;
    private static sanitizeIdentifier;
    private static sanitizeSingleLine;
    private static sanitizeMultiline;
    private static normalizeMongoKey;
    private static removeEmptyFields;
    private static isPlainObject;
}
