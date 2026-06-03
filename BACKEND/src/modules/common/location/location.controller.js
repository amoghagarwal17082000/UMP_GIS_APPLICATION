const model = require('./location.model');

async function getStates(_req, res, next) {
  try {
    const states = await model.getStates();
    res.json({ success: true, data: states });
  } catch (err) {
    next(err);
  }
}

async function getDistricts(req, res, next) {
  try {
    const districts = await model.getDistricts({
      state: req.query.state,
      state_lgd: req.query.state_lgd,
    });
    res.json({ success: true, data: districts });
  } catch (err) {
    next(err);
  }
}

async function getParliamentaryConstituencies(req, res, next) {
  try {
    const constituencies = await model.getParliamentaryConstituencies({
      state: req.query.state,
      q: req.query.q,
      search: req.query.search,
    });
    res.json({ success: true, data: constituencies });
  } catch (err) {
    next(err);
  }
}

async function getRailways(_req, res, next) {
  try {
    const railways = await model.getRailways();
    res.json({ success: true, data: railways });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStates,
  getDistricts,
  getParliamentaryConstituencies,
  getRailways,
};
