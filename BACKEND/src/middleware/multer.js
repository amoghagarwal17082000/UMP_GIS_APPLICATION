// @ts-nocheck
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use OS temp dir as fallback — always exists on any OS
const TEMP_DIR = process.env.UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'gis_uploads');

// Create it if it doesn't exist
try {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log('📁 Upload temp dir:', TEMP_DIR);
} catch (err) {
  console.error('❌ Failed to create temp dir:', err.message);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});

const SHAPEFILE_EXTS = ['.shp', '.dbf', '.shx', '.prj', '.cpg', '.sbn', '.sbx', '.cbf'];

const shapefileUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SHAPEFILE_EXTS.includes(ext)) return cb(null, true);
    cb(new Error(`Invalid extension "${ext}". Allowed: ${SHAPEFILE_EXTS.join(', ')}`));
  },
}).any();

const generalUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).array('files');

module.exports = { shapefileUpload, generalUpload, TEMP_DIR };