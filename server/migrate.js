import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  try {
    console.log("[Migration] Starting database migration...");

    const schema = fs.readFileSync(
      path.join(__dirname, "schema.sql"),
      "utf8"
    );

    const statements = schema
      .split(";")
      .map(statement => statement.trim())
      .filter(statement => statement.length > 0);

    for (const statement of statements) {
      await pool.query(statement);
    }

    console.log("[Migration] Database schema created successfully.");
    process.exit(0);
  } catch (err) {
    console.error("[Migration] Failed:", err);
    process.exit(1);
  }
}

migrate();