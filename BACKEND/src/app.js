const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const authenticateToken = require('./middleware/auth');
const authRoutes = require('./modules/auth/auth.routes');
const commonLayersRoutes = require('./modules/common/view/layers/layers.routes');
const ceaViewRoutes = require('./modules/departments/civilEngineeringAssets/view/layers/layers.routes');
const ceaDashboardRoutes = require('./modules/departments/civilEngineeringAssets/view/dashboard/dashboard.routes');
const ceaEditRoutes = require('./modules/departments/civilEngineeringAssets/edit/edit.routes');
const userManagementRoutes = require('./modules/user-management/view/users/users.routes');
const ratingRoutes = require('./modules/rating/rating.routes');
const feedbackRoutes = require('./modules/feedback/feedback.routes');


const app = express();
//ggg

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



// ✅ change these two:
app.use('/api/common/view/layers', authenticateToken, commonLayersRoutes);
app.use('/api/civil_engineering_assets/view/layers', authenticateToken, ceaViewRoutes);
app.use('/api/civil_engineering_assets/view/dashboard', authenticateToken, ceaDashboardRoutes);
app.use('/api/civil_engineering_assets/edit', authenticateToken, ceaEditRoutes);
app.use('/api/rating', authenticateToken, ratingRoutes);
app.use('/api/user-management/view/users',authenticateToken, userManagementRoutes);
app.use('/api/feedback',authenticateToken, feedbackRoutes);



app.use(notFound);
app.use(errorHandler);

module.exports = app;

