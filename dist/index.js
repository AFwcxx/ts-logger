"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor() {
        throw new Error("Logger cannot be instantiated.");
    }
    static async write(db, input) {
        this.assertDb(db);
        this.validateInput(input);
        const document = this.buildDocument(input);
        const result = await db
            .collection(this.COLLECTION_NAME)
            .insertOne(document);
        return result.insertedId;
    }
    static async ensureIndexes(db) {
        this.assertDb(db);
        const collection = db.collection(this.COLLECTION_NAME);
        await collection.createIndexes([
            { key: { timestamp: -1 }, name: "idx_timestamp_desc" },
            { key: { level: 1, timestamp: -1 }, name: "idx_level_timestamp" },
            { key: { traceId: 1 }, name: "idx_trace_id", sparse: true },
            { key: { requestId: 1 }, name: "idx_request_id", sparse: true },
            { key: { correlationId: 1 }, name: "idx_correlation_id", sparse: true },
            { key: { service: 1, environment: 1, timestamp: -1 }, name: "idx_service_env_timestamp" }
        ]);
    }
    static buildDocument(input) {
        const error = input.errorCode || input.errorName || input.stack
            ? {
                code: this.sanitizeField(input.errorCode),
                name: this.sanitizeField(input.errorName),
                stack: this.sanitizeMultiline(input.stack, this.MAX_STACK_LENGTH)
            }
            : undefined;
        const document = {
            timestamp: new Date(),
            level: input.level,
            message: this.sanitizeSingleLine(input.message, this.MAX_MESSAGE_LENGTH, true),
            service: this.sanitizeField(input.service, true),
            environment: this.sanitizeField(input.environment, true),
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
    static validateInput(input) {
        if (!input || typeof input !== "object") {
            throw new TypeError("Log input must be a valid object.");
        }
        const validLevels = ["debug", "info", "warn", "error", "fatal"];
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
    static assertDb(db) {
        if (!db || typeof db.collection !== "function") {
            throw new TypeError("A valid MongoDB Db instance is required.");
        }
    }
    static sanitizeContext(value) {
        if (!value) {
            return undefined;
        }
        const seen = new WeakSet();
        const sanitized = this.sanitizeUnknown(value, 0, seen);
        return this.isPlainObject(sanitized)
            ? sanitized
            : undefined;
    }
    static sanitizeUnknown(value, depth, seen) {
        if (depth > this.MAX_CONTEXT_DEPTH) {
            return "[MAX_DEPTH_REACHED]";
        }
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean") {
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
            if (seen.has(value)) {
                return "[CIRCULAR_REFERENCE]";
            }
            seen.add(value);
            if (!this.isPlainObject(value)) {
                return String(value);
            }
            const entries = Object.entries(value).slice(0, this.MAX_OBJECT_KEYS);
            const sanitizedObject = {};
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
    static sanitizeField(value, required = false) {
        const sanitized = this.sanitizeSingleLine(value, this.MAX_FIELD_LENGTH, required);
        return sanitized;
    }
    static sanitizeIdentifier(value) {
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
    static sanitizeSingleLine(value, maxLength, required = false) {
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
    static sanitizeMultiline(value, maxLength) {
        if (!value) {
            return undefined;
        }
        const normalized = value
            .replace(/\u0000/g, "")
            .replace(/\r/g, "")
            .slice(0, maxLength);
        return normalized || undefined;
    }
    static normalizeMongoKey(key) {
        return key
            .trim()
            .replace(/\u0000/g, "")
            .replace(/\$/g, "_")
            .replace(/\./g, "_")
            .slice(0, this.MAX_FIELD_LENGTH) || "unknown_key";
    }
    static removeEmptyFields(obj) {
        if (!obj) {
            return undefined;
        }
        const output = Object.fromEntries(Object.entries(obj).filter(([, value]) => {
            if (value === undefined) {
                return false;
            }
            if (value && typeof value === "object" && !Array.isArray(value)) {
                return Object.keys(value).length > 0;
            }
            return true;
        }));
        return output;
    }
    static isPlainObject(value) {
        if (Object.prototype.toString.call(value) !== "[object Object]") {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
}
exports.Logger = Logger;
Logger.COLLECTION_NAME = "logger";
Logger.MAX_MESSAGE_LENGTH = 2_000;
Logger.MAX_FIELD_LENGTH = 256;
Logger.MAX_STACK_LENGTH = 8_000;
Logger.MAX_CONTEXT_DEPTH = 5;
Logger.MAX_OBJECT_KEYS = 50;
Logger.MAX_ARRAY_LENGTH = 50;
Logger.REDACTED_VALUE = "[REDACTED]";
Logger.SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|authorization|cookie|session|apikey|api_key|access_token|refresh_token|private_key|client_secret/i;
//# sourceMappingURL=index.js.map