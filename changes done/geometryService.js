const express = require("express");
const multer = require("multer");
const { pool } = require("../db/pool");
const { parse } = require("csv-parse");
const fs = require("fs");

const router = express.Router();

// 2. Multer Configuration for File Uploads
const upload = multer({ dest: "uploads/" });

/**
 * Helper function to convert Degrees Minutes Seconds (DMS) to Decimal Degrees (DD)
 * Handles clean decimal numbers as well as DMS formats like: 29° 48' 2" E or 29Â° 48'
 */
function convertDMSToDecimal(dmsStr) {
  if (!dmsStr) return NaN;

  // Clean common character encoding artifacts (like Â from raw CSV views)
  const cleanStr = dmsStr.toString().replace(/Â/g, "").trim();
  const num = parseFloat(cleanStr);

  // If it's already a clean decimal number, return it directly
  if (!isNaN(num) && !cleanStr.includes("°") && !cleanStr.includes("'")) {
    return num;
  }

  // Extract all continuous numeric parts (degrees, minutes, seconds)
  const matches = cleanStr.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return NaN;

  const degrees = parseFloat(matches[0]) || 0;
  const minutes = parseFloat(matches[1]) || 0;
  const seconds = parseFloat(matches[2]) || 0;

  let decimal = degrees + minutes / 60 + seconds / 3600;

  // Account for Southern or Western hemisphere notations
  if (/[SWsw]/i.test(cleanStr)) {
    decimal = -decimal;
  }

  return decimal;
}

/**
 * Helper function to find latitude and longitude column names flexibly
 */
function findCoordinateKeys(row) {
  const keys = Object.keys(row);
  const latKey = keys.find((k) => /^(lat|latitude)$/i.test(k.trim()));
  const longKey = keys.find((k) => /^(long|longitude|lng)$/i.test(k.trim()));
  return { latKey, longKey };
}

// 3. API Endpoint to upload CSV and save geometries as a single merged collection
router.post(
  "/upload-csv-geometry",
  upload.single("csvFile"),
  async (req, res) => {
    const { layerName } = req.body; // Passed from UI selection
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No CSV file uploaded." });
    }
    if (!layerName) {
      return res.status(400).json({ error: "No target layer selected." });
    }

    const records = [];

    // Parse the CSV File
    fs.createReadStream(file.path)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data", (data) => records.push(data))
      .on("end", async () => {
        try {
          if (records.length === 0) {
            throw new Error("The uploaded CSV file is empty.");
          }

          // Detect column names dynamically from the first row
          const { latKey, longKey } = findCoordinateKeys(records[0]);

          if (!latKey || !longKey) {
            throw new Error(
              "Could not find valid Latitude (lat) or Longitude (long) columns in CSV.",
            );
          }

          // Arrays to hold collected coordinates
          const longitudes = [];
          const latitudes = [];

          for (const row of records) {
            const lat = convertDMSToDecimal(row[latKey]);
            const long = convertDMSToDecimal(row[longKey]);

            // Filter out rows with invalid or incomplete data points
            if (!isNaN(lat) && !isNaN(long)) {
              longitudes.push(long);
              latitudes.push(lat);
            }
          }

          if (longitudes.length === 0) {
            throw new Error("No valid spatial coordinates could be extracted from the CSV.");
          }

          const client = await pool.connect();
          try {
            await client.query("BEGIN");

            // ST_Collect wraps all points passed through arrays into a SINGLE Multipoint row
            const insertQuery = `
              INSERT INTO sde.shapefile_table (layer_name, geometry)
              VALUES (
                $1, 
                ST_SetSRID(
                  ST_Collect(
                    ARRAY(
                      SELECT ST_MakePoint(lng, lat) 
                      FROM unnest($2::float[], $3::float[]) AS t(lng, lat)
                    )
                  ), 
                  4326
                )
              );
            `;

            await client.query(insertQuery, [layerName, longitudes, latitudes]);

            await client.query("COMMIT");
            res.status(200).json({
              success: true,
              message: `Successfully combined ${longitudes.length} station points into a single geometry row for layer: ${layerName}`,
            });
          } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
          } finally {
            client.release();
          }
        } catch (error) {
          res.status(500).json({ error: error.message });
        } finally {
          // Clean up the uploaded file from server storage
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
      })
      .on("error", (err) => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res
          .status(500)
          .json({ error: "Failed to parse CSV file: " + err.message });
      });
  },
);

module.exports = router;