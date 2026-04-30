/**
 * Parses bbox query param into SQL where clause and params
 * Expected format: minX,minY,maxX,maxY (EPSG:4326)
 */
function parseBbox(bbox) {
  // Default: no bbox → return all geometries
  if (!bbox) {
    return {
      where: 'shape IS NOT NULL',
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
      'shape IS NOT NULL AND ST_Intersects(shape, ST_MakeEnvelope($1,$2,$3,$4,4326))',
    params: parts,
  };
}

module.exports = parseBbox;
