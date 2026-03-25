module.exports = {
  station: {
    table: 'sde.station',
    idColumn: 'objectid',
    idStrategy: 'manual', // manual MAX()+1 for now
    draftWorkflow: {
      table: 'sde.station_edit',
      editIdColumn: 'edit_id',
      originalIdColumn: 'original_id',
      statusColumn: 'status',
      checkerColumn: 'checkerdet',
      approverColumn: 'approverdet',
      originalStatusValue: 'Under Editing',
      draftStatusValue: 'Sent to Checker'
    },
    validation: {
      table: 'sde.station_1_code',
      idColumn: 'objectid',
      idStrategy: 'manual',
      insertFields: [
        'station_code',
        'station_valid_from',
        'station_valid_upto',
        'station_name',
        'zone_code',
        'division_code',
        'category'
      ]
    },

    geometry: {
      enabled: true,
      type: 'Point',
      column: 'shape',
      xField: 'xcoord',
      yField: 'ycoord'
    },

    insertFields: [
      'sttncode',
      'sttnname',
      'sttntype',
      'distkm',
      'distm',
      'state',
      'district',
      'constituncy',
      'latitude',
      'longitude',
      'xcoord',
      'ycoord',
      'railway',
      'category'
    ],

    updateFields: [
      'distkm',
      'distm',
      'state',
      'district',
      'constituncy',
      'sttnname',
      'category',
      'sttntype'
    ],

    searchableFields: [
      'sttncode',
      'state',
      'district'
    ]
  }
};

