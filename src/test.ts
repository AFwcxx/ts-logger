"use strict";

import { Logger } from "./index";
import { MongoClient, Db } from "mongodb";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function getMongoDb(uri: string, dbName: string): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  if (!uri) {
    throw new Error("Missing MONGODB_URI environment variable.");
  }

  if (!dbName) {
    throw new Error("Missing MONGODB_DB_NAME environment variable.");
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    retryWrites: true
  });

  await client.connect();

  cachedClient = client;
  cachedDb = client.db(dbName);

  return cachedDb;
}

export async function closeMongoConnection(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}

async function main() {
  const db = await getMongoDb("mongodb://localhost:27017", "ts-logger");
  await Logger.write(db, {
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
    // stack: error instanceof Error ? error.stack : undefined,
    context: {
      orderId: "order-001",
      endpoint: "/api/payments",
      paymentProvider: "stripe",
      authToken: "should-not-be-stored"
    }
  });
}
main().catch(console.log);
