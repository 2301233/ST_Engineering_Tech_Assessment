/**
 * This file contains the following unit tests
 * (Testing wiring of routes -> service call)
 *
 * 1. initDB()
 *    - Creates the `csv_data` table when called
 *    - Releases the database client on success
 *    - Releases the client even when table creation fails
 *
 * 2. POST /upload
 *    - Returns 400 when no file is uploaded
 *    - Calls `insertCSV` and deletes the uploaded file on success
 *    - Returns 500 when CSV insertion fails
 *    - Returns 500 if file cleanup (unlink) throws an error
 *
 * 3. GET /data
 *    - Returns paginated CSV records
 *    - Executes COUNT and SELECT queries correctly
 *    - Applies filters (name, email, body, post_id, csv_id)
 *    - Calculates LIMIT and OFFSET correctly
 *    - Clamps invalid page/limit values to defaults
 *    - Returns 500 if database queries fail
 *    - Always releases the database client
 *
 * 4. DELETE /data
 *    - Truncates the CSV table and resets identity on success
 *    - Returns 500 on database failure
 *    - Releases the database client in all cases
 */

import { jest } from "@jest/globals";
import request from "supertest";

// prevent server startup
process.env.NODE_ENV = "test";

// Multer
let provideFile = true;
let providedFilePath = "uploads/fake.csv";

// Pool
const mockClient = {
  query: jest.fn<any>(),
  release: jest.fn(),
};
const mockPool = {
  connect: jest.fn(async () => mockClient),
};

// InsertCSV
const insertCSVMock = jest.fn<any>();
let status = { current: 0, total: 0, message: "" };

// fs
const unlinkSyncMock = jest.fn();

await jest.unstable_mockModule("./db.js", () => ({
  pool: mockPool,
}));

await jest.unstable_mockModule("./csvService.js", () => ({
  insertCSV: insertCSVMock,
  getUploadStatus: () => status,
}));

await jest.unstable_mockModule("fs", () => ({
  unlinkSync: unlinkSyncMock,
}));

await jest.unstable_mockModule("csv-parser", () => ({
  default: jest.fn(() => ({})),
}));

await jest.unstable_mockModule("multer", () => ({
  default: () => ({
    single: () => (req: any, _res: any, next: any) => {
      if (provideFile) req.file = { path: providedFilePath };
      next();
    },
  }),
}));

// import AFTER mocks
const { app, initDB } = await import("./index.js");

afterEach(() => {
  jest.clearAllMocks();
  provideFile = true;
  providedFilePath = "uploads/fake.csv";
  status = { current: 0, total: 0, message: "" };
});

describe("initDB", () => {
  it("creates table and releases client", async () => {
    mockClient.query.mockResolvedValueOnce({});

    await initDB();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS csv_data")
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("releases client on error", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("DB error"));

    await expect(initDB()).rejects.toThrow("DB error");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

describe("POST /upload", () => {
  it("400 if no file uploaded", async () => {
    provideFile = false;

    const res = await request(app).post("/upload");

    expect(res.status).toBe(400);
    expect(res.text).toBe("No file uploaded");
    expect(insertCSVMock).not.toHaveBeenCalled();
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it("200 success: calls insertCSV and unlinks file", async () => {
    insertCSVMock.mockResolvedValueOnce(undefined);
    providedFilePath = "uploads/unit.csv";

    const res = await request(app).post("/upload");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "CSV uploaded successfully" });

    expect(insertCSVMock).toHaveBeenCalledWith("uploads/unit.csv");
    expect(unlinkSyncMock).toHaveBeenCalledWith("uploads/unit.csv");
  });

  it("500 when insertCSV fails and does not unlink", async () => {
    insertCSVMock.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(app).post("/upload");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to process CSV");
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });
});

describe("GET /data", () => {
  it("returns rows + total with pagination", async () => {
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "6" }] };
      return { rows: [{ id: 1, post_id: 1, csv_id: 10, name: "Alice", email: "a@a.com", body: "Hello" }] };
    });

    const res = await request(app).get("/data").query({ page: 2, limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    expect(res.body.page).toBe(2);
    expect(res.body.data[0].name).toBe("Alice");

    const selectCall = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes("ORDER BY id LIMIT")
    )!;
    const selectParams = selectCall[1] as any[];
    expect(selectParams[selectParams.length - 2]).toBe(5); // limit
    expect(selectParams[selectParams.length - 1]).toBe(5); // offset

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("applies filters into COUNT query params", async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "1" }] };
      return { rows: [] };
    });

    const res = await request(app).get("/data").query({
      page: 1,
      limit: 5,
      name: "Al",
      email: "test",
      body: "Hello",
      post_id: "1",
      csv_id: "10",
    });

    expect(res.status).toBe(200);

    const firstCall = mockClient.query.mock.calls[0];
    expect(firstCall).toBeTruthy();

    const [countSql, countParams] = firstCall as [string, any[]?];
    expect(String(countSql)).toContain("name ILIKE");
    expect(String(countSql)).toContain("post_id =");
    expect(countParams).toEqual(expect.arrayContaining(["%Al%", "%test%", "%Hello%", "1", "10"]));
  });
});

describe("DELETE /data", () => {
  it("200 on success", async () => {
    mockClient.query.mockResolvedValueOnce({});

    const res = await request(app).delete("/data");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Database cleared successfully" });
    expect(mockClient.query).toHaveBeenCalledWith("TRUNCATE TABLE csv_data RESTART IDENTITY");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("500 on failure", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("fail"));

    const res = await request(app).delete("/data");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to clear database" });
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

// Edge Cases

it("GET /data clamps invalid page/limit to defaults", async () => {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
    return { rows: [] };
  });

  const res = await request(app).get("/data").query({ page: 0, limit: 0 });

  expect(res.status).toBe(200);

  const selectCall = mockClient.query.mock.calls.find(([sql]) =>
    String(sql).includes("ORDER BY id LIMIT")
  )!;
  const params = (selectCall[1] as any[]) ?? [];

  expect(params[params.length - 2]).toBe(10); // limit
  expect(params[params.length - 1]).toBe(0);  // offset
});

it("GET /data returns 500 if count query fails and still releases client", async () => {
  mockClient.query.mockRejectedValueOnce(new Error("count failed"));

  const res = await request(app).get("/data").query({ page: 1, limit: 5 });

  expect(res.status).toBe(500);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});

it("POST /upload returns 500 if unlinkSync throws", async () => {
  provideFile = true;
  providedFilePath = "uploads/unlink-throws.csv";

  insertCSVMock.mockResolvedValueOnce(undefined);

  unlinkSyncMock.mockImplementationOnce(() => {
    throw new Error("unlink failed");
  });

  const res = await request(app).post("/upload");

  expect(res.status).toBe(500);
  expect(res.body.error).toBe("Failed to process CSV");

  expect(insertCSVMock).toHaveBeenCalledWith("uploads/unlink-throws.csv");
  expect(unlinkSyncMock).toHaveBeenCalledWith("uploads/unlink-throws.csv");
});