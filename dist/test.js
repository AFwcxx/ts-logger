"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeMongoConnection = closeMongoConnection;
const index_1 = require("./index");
const mongodb_1 = require("mongodb");
let cachedClient = null;
let cachedDb = null;
async function getMongoDb(uri, dbName) {
    if (cachedDb) {
        return cachedDb;
    }
    if (!uri) {
        throw new Error("Missing MONGODB_URI environment variable.");
    }
    if (!dbName) {
        throw new Error("Missing MONGODB_DB_NAME environment variable.");
    }
    const client = new mongodb_1.MongoClient(uri, {
        maxPoolSize: 10,
        retryWrites: true
    });
    await client.connect();
    cachedClient = client;
    cachedDb = client.db(dbName);
    return cachedDb;
}
async function closeMongoConnection() {
    if (cachedClient) {
        await cachedClient.close();
        cachedClient = null;
        cachedDb = null;
    }
}
async function main() {
    const db = await getMongoDb("mongodb://localhost:27017", "ts-logger");
    await index_1.Logger.write(db, {
        level: "error",
        message: "Payment gateway timeout during checkout",
        service: "billing-api",
        environment: "production",
        component: "checkout",
        operation: "createPayment",
        status: "failed",
        traceId: "trace-123",
        requestId: "req-456",
        userId: "user-789",
        errorCode: "PAYMENT_TIMEOUT",
        errorName: "GatewayTimeoutError",
        context: {
            orderId: "order-001",
            endpoint: "/api/payments",
            paymentProvider: "stripe",
            authToken: "should-not-be-stored"
        }
    });
}
main().catch(console.log);
//# sourceMappingURL=test.js.map