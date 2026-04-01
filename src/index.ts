"use strict";

import { Db, Document, ObjectId } from "mongodb";

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

interface LogDocument extends Document {
  _id?: ObjectId;
  timestamp: Date;
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

  error?: {
    code?: string;
    name?: string;
    stack?: string;
  };

  context?: Record<string, unknown>;
}

export class Logger {
  private static readonly COLLECTION_NAME = "logger";

  private static readonly MAX_MESSAGE_LENGTH = 2_000;
  private static readonly MAX_FIELD_LENGTH = 256;
  private static readonly MAX_STACK_LENGTH = 8_000;
  private static readonly MAX_CONTEXT_DEPTH = 5;
  private static readonly MAX_OBJECT_KEYS = 50;
  private static readonly MAX_ARRAY_LENGTH = 50;

  private static readonly REDACTED_VALUE = "[REDACTED]";

  private static readonly SENSITIVE_KEY_PATTERN =
    /password|passwd|secret|token|authorization|cookie|session|apikey|api_key|access_token|refresh_token|private_key|client_secret/i;

  private constructor() {
    throw new Error("Logger cannot be instantiated.");
  }

  public static async write(db: Db, input: LogEntryInput): Promise<ObjectId> {
    this.assertDb(db);
    this.validateInput(input);

    const document = this.buildDocument(input);
    const result = await db
      .collection<LogDocument>(this.COLLECTION_NAME)
      .insertOne(document);

    return result.insertedId;
  }

  /**
   * Optional helper to create indexes for common lookup patterns.
   * Call this once during service startup if appropriate.
   */
  public static async ensureIndexes(db: Db): Promise<void> {
    this.assertDb(db);

    const collection = db.collection<LogDocument>(this.COLLECTION_NAME);

    await collection.createIndexes([
      { key: { timestamp: -1 }, name: "idx_timestamp_desc" },
      { key: { level: 1, timestamp: -1 }, name: "idx_level_timestamp" },
      { key: { traceId: 1 }, name: "idx_trace_id", sparse: true },
      { key: { requestId: 1 }, name: "idx_request_id", sparse: true },
      { key: { correlationId: 1 }, name: "idx_correlation_id", sparse: true },
      { key: { service: 1, environment: 1, timestamp: -1 }, name: "idx_service_env_timestamp" }
    ]);
  }

  private static buildDocument(input: LogEntryInput): LogDocument {
    const error =
      input.errorCode || input.errorName || input.stack
        ? {
            code: this.sanitizeField(input.errorCode),
            name: this.sanitizeField(input.errorName),
            stack: this.sanitizeMultiline(input.stack, this.MAX_STACK_LENGTH)
          }
        : undefined;

    const document: LogDocument = {
      timestamp: new Date(),
      level: input.level,
      message: this.sanitizeSingleLine(input.message, this.MAX_MESSAGE_LENGTH, true),
      service: this.sanitizeField(input.service, true)!,
      environment: this.sanitizeField(input.environment, true)!,

      component: this.sanitizeField(input.component),
      operation: this.sanitizeField(input.operation),
      status: this.sanitizeField(input.status),

      traceId: this.sanitizeIdentifier(input.traceId),
      requestId: this.sanitizeIdentifier(input.requestId),
      correlationId: this.sanitizeIdentifier(input.correlationId),

      userId: this.sanitizeIdentifier(input.userId),
      sessionId: this.sanitizeIdentifier(input.sessionId),

      error: this.removeEmptyFields(error),
      context: this.sanitizeContext(input.context)
    };

    return this.removeEmptyFields(document);
  }

  private static validateInput(input: LogEntryInput): void {
    if (!input || typeof input !== "object") {
      throw new TypeError("Log input must be a valid object.");
    }

    const validLevels: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];
    if (!validLevels.includes(input.level)) {
      throw new TypeError(`Invalid log level: ${String(input.level)}`);
    }

    if (!input.message || typeof input.message !== "string") {
      throw new TypeError("Log message is required and must be a string.");
    }

    if (!input.service || typeof input.service !== "string") {
      throw new TypeError("Service is required and must be a string.");
    }

    if (!input.environment || typeof input.environment !== "string") {
      throw new TypeError("Environment is required and must be a string.");
    }

    if (input.context !== undefined && !this.isPlainObject(input.context)) {
      throw new TypeError("Context must be a plain object when provided.");
    }
  }

  private static assertDb(db: Db): void {
    if (!db || typeof db.collection !== "function") {
      throw new TypeError("A valid MongoDB Db instance is required.");
    }
  }

  private static sanitizeContext(
    value: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    if (!value) {
      return undefined;
    }

    const seen = new WeakSet<object>();
    const sanitized = this.sanitizeUnknown(value, 0, seen);

    return this.isPlainObject(sanitized)
      ? (sanitized as Record<string, unknown>)
      : undefined;
  }

  private static sanitizeUnknown(
    value: unknown,
    depth: number,
    seen: WeakSet<object>
  ): unknown {
    if (depth > this.MAX_CONTEXT_DEPTH) {
      return "[MAX_DEPTH_REACHED]";
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return typeof value === "string"
        ? this.sanitizeMultiline(value, this.MAX_MESSAGE_LENGTH)
        : value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      return {
        name: this.sanitizeField(value.name),
        message: this.sanitizeMultiline(value.message, this.MAX_MESSAGE_LENGTH),
        stack: this.sanitizeMultiline(value.stack, this.MAX_STACK_LENGTH)
      };
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, this.MAX_ARRAY_LENGTH)
        .map((item) => this.sanitizeUnknown(item, depth + 1, seen));
    }

    if (typeof value === "object") {
      if (seen.has(value as object)) {
        return "[CIRCULAR_REFERENCE]";
      }

      seen.add(value as object);

      if (!this.isPlainObject(value)) {
        return String(value);
      }

      const entries = Object.entries(value).slice(0, this.MAX_OBJECT_KEYS);
      const sanitizedObject: Record<string, unknown> = {};

      for (const [rawKey, rawValue] of entries) {
        const key = this.normalizeMongoKey(rawKey);

        if (this.SENSITIVE_KEY_PATTERN.test(rawKey)) {
          sanitizedObject[key] = this.REDACTED_VALUE;
          continue;
        }

        sanitizedObject[key] = this.sanitizeUnknown(rawValue, depth + 1, seen);
      }

      return sanitizedObject;
    }

    return String(value);
  }

  private static sanitizeField(
    value: string | undefined,
    required = false
  ): string | undefined {
    const sanitized = this.sanitizeSingleLine(
      value,
      this.MAX_FIELD_LENGTH,
      required
    );

    return sanitized;
  }

  private static sanitizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value
      .trim()
      .replace(/[\r\n\t]/g, " ")
      .replace(/[^\w:@./-]/g, "_")
      .slice(0, this.MAX_FIELD_LENGTH);

    return normalized || undefined;
  }

  private static sanitizeSingleLine(
    value: string | undefined,
    maxLength: number,
    required = false
  ): string {
    if (value === undefined || value === null) {
      if (required) {
        throw new TypeError("A required string field is missing.");
      }
      return "";
    }

    const normalized = value
      .trim()
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, maxLength);

    if (!normalized && required) {
      throw new TypeError("A required string field is empty after sanitization.");
    }

    return normalized || "";
  }

  private static sanitizeMultiline(
    value: string | undefined,
    maxLength: number
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value
      .replace(/\u0000/g, "")
      .replace(/\r/g, "")
      .slice(0, maxLength);

    return normalized || undefined;
  }

  private static normalizeMongoKey(key: string): string {
    return key
      .trim()
      .replace(/\u0000/g, "")
      .replace(/\$/g, "_")
      .replace(/\./g, "_")
      .slice(0, this.MAX_FIELD_LENGTH) || "unknown_key";
  }

  private static removeEmptyFields<T extends Record<string, unknown>>(obj: T): T;
  private static removeEmptyFields<T extends Record<string, unknown>>(
    obj: T | undefined
  ): T | undefined;
  private static removeEmptyFields<T extends Record<string, unknown>>(
    obj: T | undefined
  ): T | undefined {
    if (!obj) {
      return undefined;
    }

    const output = Object.fromEntries(
      Object.entries(obj).filter(([, value]) => {
        if (value === undefined) {
          return false;
        }

        if (value instanceof Date) {
          return true;
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
          return Object.keys(value).length > 0;
        }

        return true;
      })
    );

    return output as T;
  }

  private static isPlainObject(value: unknown): value is Record<string, unknown> {
    if (Object.prototype.toString.call(value) !== "[object Object]") {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
}
