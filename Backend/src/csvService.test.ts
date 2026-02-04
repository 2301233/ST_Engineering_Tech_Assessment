/**
 * This file contains the following unit tests:
 * 
 * 1. Successful CSV Insertion
 *    - Inserts valid CSV rows into the database
 *    - Skips invalid rows (missing required fields)
 *    - Executes only one database insert for valid rows
 *    - Releases the database client after completion
 *
 * 2. Database Error Handling
 *    - Rejects when a database insert fails
 *    - Still releases the database client on failure
 *
 * 3. Empty CSV Handling
 *    - Resolves successfully when CSV contains no rows
 *    - Does not perform any database insert
 *    - Releases the database client
 *
 * 4. Invalid Row Filtering
 *    - Skips all invalid rows
 *    - Performs zero database insert operations
 *    - Resolves without error
 */

import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

process.env.NODE_ENV = "test";

// DB mocks
const mockClient = {
  query: jest.fn<any>(),
  release: jest.fn(),
};
const mockPool = {
  connect: jest.fn(async () => mockClient),
};

// Stream emitter per call
let lastStream: EventEmitter | null = null;

await jest.unstable_mockModule("./db.js", () => ({
  pool: mockPool,
}));

await jest.unstable_mockModule("fs", () => ({
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(() => {
      lastStream = new EventEmitter();
      return lastStream;
    }),
  })),
}));

await jest.unstable_mockModule("csv-parser", () => ({
  default: jest.fn(() => ({})),
}));

const { insertCSV } = await import("./csvService.js");

afterEach(() => {
  jest.clearAllMocks();
  lastStream?.removeAllListeners();
  lastStream = null;
});

describe("insertCSV (real)", () => {
  it("inserts valid rows and skips invalid ones", async () => {
    mockClient.query.mockResolvedValue({});

    const promise = insertCSV("fake.csv");
    expect(lastStream).toBeTruthy();

    lastStream!.emit("data", {
      postId: "1",
      id: "10",
      name: "Alice",
      email: "alice@test.com",
      body: "Hello",
    });

    lastStream!.emit("data", {
      postId: null,
      id: "11",
      name: "Bob",
      email: "bob@test.com",
      body: "Hi",
    });

    lastStream!.emit("end");
    await promise;

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("rejects if DB insert fails (and still releases client)", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("DB error"));

    const promise = insertCSV("fake.csv");
    expect(lastStream).toBeTruthy();

    lastStream!.emit("data", {
      postId: "1",
      id: "10",
      name: "Alice",
      email: "alice@test.com",
      body: "Hello",
    });

    lastStream!.emit("end");

    await expect(promise).rejects.toThrow("DB error");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("resolves with empty CSV (0 rows) and does not insert", async () => {
    mockClient.query.mockResolvedValue({});

    const p = insertCSV("fake.csv");
    expect(lastStream).toBeTruthy();

    lastStream!.emit("end");

    await expect(p).resolves.toBeUndefined();
    expect(mockClient.query).toHaveBeenCalledTimes(0);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("skips all invalid rows and resolves", async () => {
    mockClient.query.mockResolvedValue({});

    const p = insertCSV("fake.csv");
    expect(lastStream).toBeTruthy();

    lastStream!.emit("data", { postId: null, id: null, name: "", email: "", body: "" });
    lastStream!.emit("data", { postId: "1", id: null, name: "A", email: "a@a.com", body: "x" });
    lastStream!.emit("end");

    await expect(p).resolves.toBeUndefined();
    expect(mockClient.query).toHaveBeenCalledTimes(0);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
