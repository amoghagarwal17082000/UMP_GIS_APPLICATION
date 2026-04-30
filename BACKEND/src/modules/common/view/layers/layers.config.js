
module.exports = {
  station: {
    table: 'sde.station',
    idColumn: 'objectid',
    geometryColumn: 'shape'
  },

  kmPost: {
    table: 'sde.km_post',
    idColumn: 'objectid',
    geometryColumn: 'shape'
  },

  railwayTrack: {
    table: 'sde.dli_track_1',
    idColumn: 'objectid',
    geometryColumn: 'shape'
  },
  
  indiaBoundary: {
  table: 'sde.india_boundry',
  idColumn: 'objectid',
  geometryColumn: 'shape',
  hasDivision: false   // 👈 IMPORTANT
}
};
