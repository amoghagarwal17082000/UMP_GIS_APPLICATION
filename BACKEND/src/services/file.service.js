// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');
const { configuration } = require('../config/configuration.ts');

const config = configuration();
const STORAGE_ROOT =
  config.UPLOADS.STORAGE_DIR ||
  path.join(__dirname, '..', '..', 'storage', 'uploads');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeSegment(value, fallback = 'item') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function makePublicBaseUrl(req) {
  if (config.UPLOADS.PUBLIC_BASE_URL) {
    return String(config.UPLOADS.PUBLIC_BASE_URL).replace(/\/+$/, '');
  }

  if (!req) return '';

  return `${req.protocol}://${req.get('host')}`;
}

function buildBundleHtml({ layerName, uploadId, files }) {
  const items = files
    .map(
      (file) => `
      <li>
        <a href="./${encodeURIComponent(file.stored_name)}" target="_blank" rel="noreferrer">
          ${file.original_name}
        </a>
        <span>${file.mimetype || 'application/octet-stream'}</span>
      </li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upload ${uploadId}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1e8;
        --panel: #fffdf8;
        --line: #d9cdb6;
        --text: #1c1914;
        --muted: #645b4d;
        --accent: #8f3d1f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, sans-serif;
        background: linear-gradient(135deg, #f4f1e8 0%, #efe5d2 100%);
        color: var(--text);
      }
      main {
        max-width: 760px;
        margin: 48px auto;
        padding: 24px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 18px 40px rgba(76, 53, 29, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        margin: 0 0 18px;
        color: var(--muted);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 20px 0 0;
      }
      li {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 0;
        border-top: 1px solid var(--line);
      }
      li:first-child {
        border-top: 0;
      }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
        word-break: break-word;
      }
      a:hover {
        text-decoration: underline;
      }
      span {
        color: var(--muted);
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        li {
          flex-direction: column;
        }
        span {
          white-space: normal;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>${layerName} upload bundle</h1>
        <p>Upload ID: ${uploadId}</p>
        <ul>${items}</ul>
      </section>
    </main>
  </body>
</html>`;
}

function cleanupFiles(files = []) {
  for (const file of files) {
    if (!file?.path) continue;
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (_) {}
  }
}

function removeBundleDirectory(bundleDir) {
  if (!bundleDir) return;

  try {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  } catch (_) {}
}

async function persistUploadBundle(files, { uploadId, layerName, req }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files received for upload bundle');
  }

  ensureDir(STORAGE_ROOT);

  const safeLayerName = sanitizeSegment(layerName, 'unassigned_layer');
  const bundleDir = path.join(STORAGE_ROOT, safeLayerName, uploadId);
  ensureDir(bundleDir);

  const storedFiles = [];

  try {
    files.forEach((file, index) => {
      const originalName = path.basename(file.originalname);
      const safeOriginalName = sanitizeSegment(originalName, `file_${index + 1}`);
      const destination = path.join(bundleDir, safeOriginalName);

      fs.renameSync(file.path, destination);

      storedFiles.push({
        original_name: originalName,
        stored_name: safeOriginalName,
        mimetype: file.mimetype || 'application/octet-stream',
        size_bytes: Number(file.size || 0),
        disk_path: destination,
        relative_path: path.posix.join(safeLayerName, uploadId, safeOriginalName),
      });
    });

    const indexPath = path.join(bundleDir, 'index.html');
    fs.writeFileSync(
      indexPath,
      buildBundleHtml({
        layerName: safeLayerName,
        uploadId,
        files: storedFiles,
      }),
      'utf8',
    );

    const publicBaseUrl = makePublicBaseUrl(req);
    const relativeBundlePath = path.posix.join('/uploads', safeLayerName, uploadId, '/');
    const bundleUrl = publicBaseUrl
      ? `${publicBaseUrl}${relativeBundlePath}`
      : relativeBundlePath;

    return {
      bundleDir,
      safeLayerName,
      relativeBundlePath,
      bundleUrl,
      files: storedFiles,
    };
  } catch (error) {
    cleanupFiles(files);
    removeBundleDirectory(bundleDir);
    throw error;
  }
}

async function ensureUploadMetadataSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id uuid PRIMARY KEY,
      original_name text,
      upload_type text
        CONSTRAINT uploads_upload_type_check 
        CHECK (upload_type IN ('shapefile', 'record_attachment')),
      layer_name text,
      file_count integer,
      bundle_url text,
      bundle_path text,
      target_table_schema text,
      target_table_name text,
      target_record_id bigint,
      feature_count integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    ALTER TABLE uploads
      ADD COLUMN IF NOT EXISTS layer_name text,
      ADD COLUMN IF NOT EXISTS bundle_url text,
      ADD COLUMN IF NOT EXISTS bundle_path text,
      ADD COLUMN IF NOT EXISTS target_table_schema text,
      ADD COLUMN IF NOT EXISTS target_table_name text,
      ADD COLUMN IF NOT EXISTS target_record_id bigint,
      ADD COLUMN IF NOT EXISTS feature_count integer
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS upload_files (
      id bigserial PRIMARY KEY,
      upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      original_name text NOT NULL,
      stored_name text NOT NULL,
      mimetype text,
      size_bytes bigint,
      relative_path text NOT NULL,
      disk_path text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_uploads_layer_name ON uploads (lower(layer_name))`,
  );

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_upload_files_upload_id ON upload_files (upload_id)`,
  );

  // Ensure the CHECK constraint allows both upload types
  try {
    await client.query(`
      ALTER TABLE uploads
      DROP CONSTRAINT IF EXISTS uploads_upload_type_check
    `);
  } catch (_) {}

  try {
    await client.query(`
      ALTER TABLE uploads
      ADD CONSTRAINT uploads_upload_type_check 
      CHECK (upload_type IN ('shapefile', 'record_attachment'))
    `);
  } catch (_) {}
}

async function saveUploadBundleRecord({
  uploadId,
  originalName,
  uploadType,
  layerName,
  fileCount,
  bundleUrl,
  relativeBundlePath,
  targetSchema = null,
  targetTable = null,
  targetRecordId = null,
  featureCount = null,
  files = [],
}) {
  const client = await pool.connect();

  try {
    await ensureUploadMetadataSchema(client);
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO uploads (
        id,
        original_name,
        upload_type,
        layer_name,
        file_count,
        bundle_url,
        bundle_path,
        target_table_schema,
        target_table_name,
        target_record_id,
        feature_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        uploadId,
        originalName,
        uploadType,
        layerName,
        fileCount,
        bundleUrl,
        relativeBundlePath,
        targetSchema,
        targetTable,
        targetRecordId,
        featureCount,
      ],
    );

    for (const file of files) {
      await client.query(
        `INSERT INTO upload_files (
          upload_id,
          original_name,
          stored_name,
          mimetype,
          size_bytes,
          relative_path,
          disk_path
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uploadId,
          file.original_name,
          file.stored_name,
          file.mimetype,
          file.size_bytes,
          file.relative_path,
          file.disk_path,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  STORAGE_ROOT,
  cleanupFiles,
  persistUploadBundle,
  removeBundleDirectory,
  saveUploadBundleRecord,
};
