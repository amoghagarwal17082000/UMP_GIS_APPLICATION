const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { shapefileUpload, kmlUpload } = require('../middleware/multer');
const { importShapefileToPostGIS } = require('../services/shapefile.service');
const { importKmlToPostGIS }       = require('../services/kmlfile.service');
const {
  cleanupFiles,
  persistUploadBundle,
  removeBundleDirectory,
  saveUploadBundleRecord,
} = require('../services/file.service');
const { pool } = require('../db/pool');
const fs = require('fs'); 
const path = require('path');
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
        cleanupFiles(req.files || (req.file ? [req.file] : []));
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

    const uploadId   = uuidv4();
    const primaryFile =
      files.find((f) => f.originalname.toLowerCase().endsWith('.shp')) || files[0];

    const bundle = await persistUploadBundle(files, { uploadId, layerName, req });

    try {
      const shapeImport = await importShapefileToPostGIS(bundle.files, uploadId, layerName);

      await saveUploadBundleRecord({
        uploadId,
        originalName:       primaryFile.originalname,
        uploadType:         'shapefile',
        layerName:          bundle.safeLayerName,
        fileCount:          bundle.files.length,
        bundleUrl:          bundle.bundleUrl,
        relativeBundlePath: bundle.relativeBundlePath,
        targetSchema:       shapeImport.targetSchema,
        targetTable:        shapeImport.targetTable,
        featureCount:       shapeImport.featureCount,
        files:              bundle.files,
      });

      return res.status(201).json({
        message:      'Shapefile uploaded and appended successfully',
        uploadId,
        layerName:    bundle.safeLayerName,
        targetTable:  `${shapeImport.targetSchema}.${shapeImport.targetTable}`,
        featureCount: shapeImport.featureCount,
        bundleUrl:    bundle.bundleUrl,
        mapping:      shapeImport.mapping,
        files:        bundle.files.map((f) => ({
          originalName: f.original_name,
          relativePath: f.relative_path,
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

router.post('/kml', withUpload(kmlUpload, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No KML file uploaded' });
    }

    const layerName = requireLayerName(req, res);
    if (!layerName) {
        cleanupFiles([req.file]);
        return;
    }

    const uploadId = uuidv4();

    // FIRST: Process the KML file while it's still in the upload temp directory
    const kmlFile = {
        original_name: req.file.originalname,
        disk_path: req.file.path,  // Use original path
    };

    console.log('Processing KML from:', kmlFile.disk_path);
    
    try {
        // Process the file FIRST
        const kmlImport = await importKmlToPostGIS(kmlFile, uploadId, layerName);
        
        // AFTER successful processing, THEN move to bundle for long-term storage
        const fileAsArray = [{
            ...req.file,
            originalname: req.file.originalname,
        }];
        
        const bundle = await persistUploadBundle(fileAsArray, { uploadId, layerName, req });
        
        await saveUploadBundleRecord({
            uploadId,
            originalName: req.file.originalname,
            uploadType: 'kml',
            layerName: bundle.safeLayerName,
            fileCount: 1,
            bundleUrl: bundle.bundleUrl,
            relativeBundlePath: bundle.relativeBundlePath,
            targetSchema: kmlImport.targetSchema,
            targetTable: kmlImport.targetTable,
            featureCount: kmlImport.featureCount,
            files: bundle.files,
        });

        return res.status(201).json({
            message: 'KML uploaded and appended successfully',
            uploadId,
            layerName: bundle.safeLayerName,
            targetTable: `${kmlImport.targetSchema}.${kmlImport.targetTable}`,
            featureCount: kmlImport.featureCount,
            bundleUrl: bundle.bundleUrl,
            mapping: kmlImport.mapping,
        });
    } catch (error) {
        // Clean up temp table only, NOT the file
        console.error('Processing error:', error);
        throw error;
    }
}));

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
       WHERE upload_type IN ('shapefile', 'kml')
       ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/layers/shapefile', async (_req, res) => {
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


router.get('/layers/kml', async (_req, res) => {
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
       WHERE upload_type = 'kml'
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


router.post('/general', (_req, res) =>
  res.status(410).json({
    error:
      'Standalone general upload has been removed. ' +
      'Upload shapefiles or KML by layer and use per-record attachments from the edit workflow.',
  }),
);

module.exports = router;