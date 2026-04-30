const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { shapefileUpload } = require('../middleware/multer');
const { importShapefileToPostGIS } = require('../services/shapefile.service');
const {
  cleanupFiles,
  persistUploadBundle,
  removeBundleDirectory,
  saveUploadBundleRecord,
} = require('../services/file.service');
const { pool } = require('../db/pool');

const router = express.Router();

function requireLayerName(req, res) {
  const layerName = String(req.body?.layerName || '').trim();
  if (!layerName) {
    res.status(400).json({ error: 'layerName is required' });
    return null;
  }

  return layerName;
}

function withUpload(middleware, handler) {
  return (req, res) => {
    middleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        await handler(req, res);
      } catch (error) {
        console.error('Upload route error:', error);
        cleanupFiles(req.files);
        return res.status(500).json({ error: error.message });
      }
    });
  };
}

router.post(
  '/shapefile',
  withUpload(shapefileUpload, async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const layerName = requireLayerName(req, res);
    if (!layerName) {
      cleanupFiles(files);
      return;
    }

    const uploadId = uuidv4();
    const primaryFile =
      files.find((file) => file.originalname.toLowerCase().endsWith('.shp')) || files[0];

    const bundle = await persistUploadBundle(files, {
      uploadId,
      layerName,
      req,
    });

    try {
      const shapeImport = await importShapefileToPostGIS(bundle.files, uploadId, layerName);

      await saveUploadBundleRecord({
        uploadId,
        originalName: primaryFile.originalname,
        uploadType: 'shapefile',
        layerName: bundle.safeLayerName,
        fileCount: bundle.files.length,
        bundleUrl: bundle.bundleUrl,
        relativeBundlePath: bundle.relativeBundlePath,
        targetSchema: shapeImport.targetSchema,
        targetTable: shapeImport.targetTable,
        featureCount: shapeImport.featureCount,
        files: bundle.files,
      });

      return res.status(201).json({
        message: 'Shapefile uploaded and appended successfully',
        uploadId,
        layerName: bundle.safeLayerName,
        targetTable: `${shapeImport.targetSchema}.${shapeImport.targetTable}`,
        featureCount: shapeImport.featureCount,
        bundleUrl: bundle.bundleUrl,
        files: bundle.files.map((file) => ({
          originalName: file.original_name,
          relativePath: file.relative_path,
        })),
      });
    } catch (error) {
      removeBundleDirectory(bundle.bundleDir);
      await pool.query('DELETE FROM upload_files WHERE upload_id = $1', [uploadId]).catch(() => {});
      await pool.query('DELETE FROM uploads WHERE id = $1', [uploadId]).catch(() => {});
      throw error;
    }
  }),
);

router.post(
  '/general',
  (_req, res) =>
    res.status(410).json({
      error:
        'Standalone general upload has been removed. Upload shapefiles by layer and use per-record attachments from the edit workflow.',
    }),
);

router.get('/layers', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        id,
        original_name,
        layer_name,
        upload_type,
        file_count,
        feature_count,
        bundle_url,
        target_table_schema,
        target_table_name,
        created_at
      FROM uploads
      WHERE upload_type = 'shapefile'
      ORDER BY created_at DESC`,
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/layer/:layerName', async (req, res) => {
  try {
    const layerName = String(req.params.layerName || '').trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT
        id,
        original_name,
        layer_name,
        upload_type,
        file_count,
        feature_count,
        bundle_url,
        target_table_schema,
        target_table_name,
        created_at
      FROM uploads
      WHERE lower(layer_name) = $1
      ORDER BY created_at DESC`,
      [layerName],
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:uploadId/files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        id,
        upload_id,
        original_name,
        stored_name,
        mimetype,
        size_bytes,
        relative_path,
        created_at
      FROM upload_files
      WHERE upload_id = $1
      ORDER BY created_at ASC, id ASC`,
      [req.params.uploadId],
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
