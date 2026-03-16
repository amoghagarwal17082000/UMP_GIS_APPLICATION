const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const commonLayersRoutes = require('./modules/common/view/layers/layers.routes');
const ceaViewRoutes = require('./modules/departments/civilEngineeringAssets/view/layers/layers.routes');
const ceaDashboardRoutes = require('./modules/departments/civilEngineeringAssets/view/dashboard/dashboard.routes');
const ceaEditRoutes = require('./modules/departments/civilEngineeringAssets/edit/edit.routes');
const userManagementRoutes = require('./modules/user-management/view/users/users.routes');
const ratingRoutes = require('./modules/rating/rating.routes');
const feedbackRoutes = require('./modules/feedback/feedback.routes');

const app = express();

app.use(cors({
  origin(origin, callback) {
    const allowed = new Set([
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ]);

    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(compression());
app.set('trust proxy', 1);

app.get('/__health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/common/view/layers', commonLayersRoutes);
app.use('/api/civil_engineering_assets/view/layers', ceaViewRoutes);
app.use('/api/civil_engineering_assets/view/dashboard', ceaDashboardRoutes);
app.use('/api/civil_engineering_assets/edit', ceaEditRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/user-management/view/users', userManagementRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

