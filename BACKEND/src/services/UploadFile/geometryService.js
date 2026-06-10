const express = require("express");
const multer = require("multer");
const { pool } = require("../../db/pool");
const { parse } = require("csv-parse");
const fs = require("fs");
const editConfig = require("../../modules/departments/civilEngineeringAssets/edit/edit.config");
const editModel = require("../../modules/departments/civilEngineeringAssets/edit/edit.model");

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

function normalizeLayerName(layerName) {
  const layer = String(layerName || "").trim().toLowerCase();
  const compact = layer.replace(/[\s-]+/g, "_");
  if (compact === "stations") return "station";
  if (compact === "rob") return "road_over_bridge";
  if (compact === "level_xing") return "levelxing";
  if (compact === "point_xing") return "pointxing";
  return compact;
}

function normalizeRowPayload(row) {
  const payload = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return;
    payload[cleanKey] = value;
    payload[cleanKey.toLowerCase()] = value;
  });
  return payload;
}

// 3. API Endpoint to upload CSV and save geometries as a single merged collection
router.post(
  "/upload-csv-geometry",
  upload.single("csvFile"),
  async (req, res) => {
    const { layerName } = req.body; // Passed from UI selection
    const division = String(req.body?.division || req.query?.division || req.user?.division || "").trim();
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || "").trim();
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No CSV file uploaded." });
    }
    if (!layerName) {
      return res.status(400).json({ error: "No target layer selected." });
    }
    if (!division) {
      return res.status(400).json({ error: "No division selected." });
    }

    const normalizedLayerName = normalizeLayerName(layerName);
    const config = editConfig[normalizedLayerName];
    if (!config) {
      return res.status(400).json({ error: `Invalid target layer: ${layerName}` });
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

          const createdRows = [];

          for (const row of records) {
            const lat = convertDMSToDecimal(row[latKey]);
            const long = convertDMSToDecimal(row[longKey]);

            if (!isNaN(lat) && !isNaN(long)) {
              const payload = {
                ...normalizeRowPayload(row),
                division,
                lat,
                lng: long,
                latitude: lat,
                longitude: long,
                ycoord: lat,
                xcoord: long,
              };
              const created = await editModel.create(config, payload, division, makerUserId);
              createdRows.push(created);
            }
          }

          if (createdRows.length === 0) {
            throw new Error("No valid spatial coordinates could be extracted from the CSV.");
          }
          const insertedObjectIds = createdRows
            .map((row) => Number(row?.[config.idColumn] ?? row?.objectid))
            .filter((id) => Number.isFinite(id));

          res.status(200).json({
            success: true,
            message: `Successfully created ${createdRows.length} asset record(s) for layer: ${layerName}`,
            layerName: normalizedLayerName,
            featureCount: createdRows.length,
            insertedObjectIds,
            firstObjectId: insertedObjectIds[0] ?? null,
          });
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
