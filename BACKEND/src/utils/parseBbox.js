/**
 * Parses bbox query param into SQL where clause and params
 * Expected format: minX,minY,maxX,maxY (EPSG:4326)
 */
function parseBbox(bbox, geometryColumn = 'shape') {
  const safeGeometryColumn = String(geometryColumn || 'shape').trim() || 'shape';
  // Default: no bbox → return all geometries
  if (!bbox) {
    return {
      where: `${safeGeometryColumn} IS NOT NULL`,
      params: [],
    };
  }

  const parts = String(bbox).split(',').map(Number);

  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    const err = new Error(
      'Invalid bbox. Use minX,minY,maxX,maxY (EPSG:4326)'
    );
    err.status = 400;
    throw err;
  }

  return {
    where:
      `${safeGeometryColumn} IS NOT NULL AND ST_Intersects(${safeGeometryColumn}, ST_MakeEnvelope($1,$2,$3,$4,4326))`,
    params: parts,
  };
}

module.exports = parseBbox;
