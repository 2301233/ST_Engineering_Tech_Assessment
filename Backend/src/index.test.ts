/**
 * This file contains the following unit tests:
 * (Testing core service behavior logic)
 * 
 * 1. initDB()
 *    - "creates table and releases client"
 *      - Verifies a CREATE TABLE IF NOT EXISTS query is executed.
 *      - Ensures the DB client is released on success.
 *
 *    - "releases client on error"
 *      - Simulates query failure.
 *      - Ensures initDB rejects and still releases the DB client.
 *
 * 2. POST /upload
 *    - "400 if no file uploaded"
 *      - Simulates multer not providing req.file.
 *      - Expects 400 and no insert/unlink calls.
 *
 *    - "200 success: calls insertCSV and unlinks file"
 *      - Simulates a valid file upload.
 *      - Expects insertCSV called with file path.
 *      - Expects unlinkSync called to remove uploaded file.
 *
 *    - "500 when insertCSV fails and does not unlink"
 *      - Simulates insertCSV throwing an error.
 *      - Expects 500 response and no unlink attempt.
 *
 *    - Edge case: "POST /upload returns 500 if unlinkSync throws"
 *      - Simulates successful insertCSV, but unlinkSync throws.
 *      - Expects 500 response and confirms both insertCSV and unlinkSync
 *        were attempted.
 *
 * 3. GET /data
 *    - "returns rows + total with pagination"
 *      - Mocks COUNT(*) and SELECT query results.
 *      - Confirms response includes { total, page, data }.
 *      - Verifies correct LIMIT/OFFSET calculation (page 2, limit 5 -> offset 5).
 *      - Ensures the DB client is released.
 *
 *    - "applies filters into COUNT query params"
 *      - Sends query filters (name/email/body/post_id/csv_id).
 *      - Ensures COUNT SQL contains filter conditions (ILIKE / equals).
 *      - Ensures COUNT params include correct formatted values (e.g. %name%).
 *
 *    - Edge case: "GET /data clamps invalid page/limit to defaults"
 *      - Sends page=0 and limit=0.
 *      - Ensures defaults are used (limit=10, offset=0) in SELECT query params.
 *
 *    - Edge case: "GET /data returns 500 if count query fails and still releases client"
 *      - Simulates COUNT query failure.
 *      - Expects 500 response and confirms DB client release.
 *
 * 4. DELETE /data
 *    - "200 on success"
 *      - Expects TRUNCATE TABLE csv_data RESTART IDENTITY query.
 *      - Confirms success response and DB client release.
 *
 *    - "500 on failure"
 *      - Simulates TRUNCATE query failing.
 *      - Expects 500 response and DB client release.
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates table and releases client", async () => {
    mockClient.query.mockResolvedValueOnce({});

    await initDB();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);

    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS csv_data")
    );

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("releases client and propagates error if query fails", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("DB error"));

    await expect(initDB()).rejects.toThrow("DB error");

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
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