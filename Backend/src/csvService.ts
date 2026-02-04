// csvService.ts
import csvParser from "csv-parser";
import * as fs from "fs";
import { pool } from "./db.js";

let uploadStatus = {
  current: 0,
  total: 0,
  message: "",
};

export function getUploadStatus() {
  return uploadStatus;
}

export function resetUploadStatus() {
  uploadStatus = { current: 0, total: 0, message: "" };
}

// Parse CSV and insert into database
export async function insertCSV(filePath: string) {
  const results: any[] = [];

  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(
        csvParser({
          mapHeaders: ({ header }) =>
            header.replace(/[^\w\s]/gi, "").trim(),
        })
      )
      .on("data", (data) => results.push(data))
      .on("end", async () => {
        const client = await pool.connect();
        try {
          uploadStatus.total = results.length;
          uploadStatus.message = "Inserting Rows into Table";

          for (let i = 0; i < results.length; i++) {
            const row = results[i];

            if (!row.postId || !row.id || !row.name || !row.email || !row.body) {
              continue;
            }

            await client.query(
              `
              INSERT INTO csv_data (post_id, csv_id, name, email, body)
              VALUES ($1, $2, $3, $4, $5)
              `,
              [Number(row.postId), Number(row.id), row.name, row.email, row.body]
            );

            uploadStatus.current = i + 1;
          }

          uploadStatus.message = "Finished";
          resolve();

          setTimeout(() => {
            uploadStatus = { current: 0, total: 0, message: "" };
          }, 2000);
        } catch (err) {
          uploadStatus.message = "Error";
          reject(err);
          return;
        } finally {
          client.release();
        }
      });
  });
}
