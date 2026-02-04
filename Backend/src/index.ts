import express from "express";
import multer from "multer";
import { pool } from "./db.js";
import * as fs from "fs";
import cors from "cors";
import { insertCSV, getUploadStatus } from "./csvService.js";

export const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

// Multer setup for file uploads
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const okExt = file.originalname.toLowerCase().endsWith(".csv");
    const okMime = ["text/csv", "application/vnd.ms-excel"].includes(file.mimetype);
    if (!okExt && !okMime) return cb(new Error("Only CSV files are allowed"));
    cb(null, true);
  },
});

// Create table if it doesn't exist
export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS csv_data(
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL CHECK (post_id > 0),
        csv_id  INTEGER NOT NULL CHECK (csv_id > 0),
        name    TEXT    NOT NULL,
        email   TEXT    NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
        body    TEXT    NOT NULL
      );
    `);
  } finally {
    client.release();
  }
}

app.use(express.json());

// Upload CSV endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");

  try {
    await insertCSV(req.file.path);
    fs.unlinkSync(req.file.path); // remove uploaded file
    res.json({ message: "CSV uploaded successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to process CSV", details: err });
  }
});

// Get data with pagination and search
app.get("/data", async (req, res) => {
  const { 
    page = "1", 
    limit = "5", 
    name = "", 
    email = "", 
    body = "", 
    post_id = "", 
    csv_id = "" 
  } = req.query;

  let pageNum = parseInt(req.query.page as string) || Number(page);
  let limitNum = parseInt(req.query.limit as string) || Number(limit);

  if (pageNum < 1) pageNum = 1;
  if (limitNum < 1) limitNum = 10;

  const offset = (pageNum - 1) * limitNum;

  const client = await pool.connect();
  try {
    let queryText = "SELECT * FROM csv_data WHERE 1=1";
    const queryParams: any[] = [];
    let paramIndex = 1;

    const addFilter = (column: string, value: any, isLike: boolean) => {
      if (value) {
        if (isLike) {
          queryText += ` AND ${column} ILIKE $${paramIndex}`;
          queryParams.push(`%${value}%`);
        } else {
          queryText += ` AND ${column} = $${paramIndex}`;
          queryParams.push(value);
        }
        paramIndex++;
      }
    };

    addFilter("name", name, true);
    addFilter("email", email, true);
    addFilter("body", body, true);
    addFilter("post_id", post_id, false);
    addFilter("csv_id", csv_id, false);

    // Get total count
    const countResult = await client.query(
      queryText.replace("SELECT *", "SELECT COUNT(*)"), 
      queryParams
    );

    // Pagination
    queryText += ` ORDER BY id LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limitNum, offset);

    const result = await client.query(queryText, queryParams);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: pageNum,
    });
  } catch (err) {
    res.status(500).json({ error: err });
  } finally {
    client.release();
  }
});

app.delete("/data", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("TRUNCATE TABLE csv_data RESTART IDENTITY");
    res.json({ message: "Database cleared successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear database" });
  } finally {
    client.release();
  }
});

app.get("/upload-progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(getUploadStatus())}\n\n`);
  }, 500);

  req.on("close", () => clearInterval(interval));
});

if (process.env.NODE_ENV !== 'test') {
  initDB().then(() => {
    app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  }).catch(err => {
    console.error("Failed to initialize database:", err);
  });
}
