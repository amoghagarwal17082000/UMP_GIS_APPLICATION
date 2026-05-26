// @ts-nocheck
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const TEMP_DIR = process.env.UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'gis_uploads');

try {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log('📁 Upload temp dir:', TEMP_DIR);
} catch (err) {
  console.error('Failed to create temp dir:', err.message);
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
const KML_EXTS       = ['.kml', '.kmz'];



const shapefileUpload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }, 
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SHAPEFILE_EXTS.includes(ext)) return cb(null, true);
    cb(new Error(`Invalid extension "${ext}". Allowed for shapefiles: ${SHAPEFILE_EXTS.join(', ')}`));
  },
}).any(); 


const kmlUpload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, 
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (KML_EXTS.includes(ext)) return cb(null, true);
    cb(new Error(`Invalid extension "${ext}". Allowed for KML: ${KML_EXTS.join(', ')}`));
  },
}).single('file'); 

const generalUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, 
}).array('files');

module.exports = { shapefileUpload, kmlUpload, generalUpload, TEMP_DIR };