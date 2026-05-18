const express = require("express");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");


const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const authenticateToken = require("./middleware/auth");
const authRoutes = require("./modules/auth/auth.routes");
const commonLocationRoutes = require("./modules/common/location/location.routes");
const commonLayersRoutes = require("./modules/common/view/layers/layers.routes");
const commonPreviewRoutes = require("./modules/common/view/preview/preview.routes");
const ceaViewRoutes = require("./modules/departments/civilEngineeringAssets/view/layers/layers.routes");
const ceaDashboardRoutes = require("./modules/departments/civilEngineeringAssets/view/dashboard/dashboard.routes");
const ceaEditRoutes = require("./modules/departments/civilEngineeringAssets/edit/edit.routes");
const userManagementRoutes = require("./modules/user-management/view/users/users.routes");
const ratingRoutes = require("./modules/rating/rating.routes");
const feedbackRoutes = require("./modules/feedback/feedback.routes");
const superAdminUsersRoutes = require("./modules/super-admin/super-admin-users.routes");
const profileRoutes= require('./modules/profile/profile.routes');
const uploadRoutes = require("./modules/Upload/upload.router");


const app = express();

function formatIstTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} IST`;
}

/* ---------- CORS ---------- */
const allowedOrigins = new Set([
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "http://10.77.56.70",
  "http://10.77.56.70:80",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

/* ---------- Logging ---------- */
morgan.token("ist-date", () => formatIstTimestamp());
app.use(
  morgan(
    ':remote-addr - - [:ist-date] \":method :url HTTP/:http-version\" :status :res[content-length] \":referrer\" \":user-agent\"',
  ),
);

/* Optional custom request log */
app.use((req, res, next) => {
  console.log(`[${formatIstTimestamp()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* ---------- Middlewares ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.set("trust proxy", 1);

/* ---------- Health ---------- */
app.get("/__health", (req, res) => {
  res.json({ ok: true });
});

/* ---------- Routes ---------- */
const apiPrefixes = ["/api", "/ump_gis/api"];

for (const prefix of apiPrefixes) {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/upload`, authenticateToken, uploadRoutes);
  app.use(`${prefix}/common/view/preview`, commonPreviewRoutes);
  app.use(
    `${prefix}/common/location`,
    authenticateToken,
    commonLocationRoutes,
  );
  app.use(
    `${prefix}/common/view/layers`,
    authenticateToken,
    commonLayersRoutes,
  );
  app.use(
    `${prefix}/civil_engineering_assets/view/layers`,
    authenticateToken,
    ceaViewRoutes,
  );
  app.use(
    `${prefix}/civil_engineering_assets/view/dashboard`,
    authenticateToken,
    ceaDashboardRoutes,
  );
  app.use(
    `${prefix}/civil_engineering_assets/edit`,
    authenticateToken,
    ceaEditRoutes,
  );
  app.use(`${prefix}/rating`, authenticateToken, ratingRoutes);
  app.use(
    `${prefix}/user-management/view/users`,
    authenticateToken,
    userManagementRoutes,
  );
  app.use(`${prefix}/feedback`, authenticateToken, feedbackRoutes);

  app.use(
    `${prefix}/super-admin/users`,
    authenticateToken,
    superAdminUsersRoutes,
  );

  app.use(`${prefix}/update`, authenticateToken, profileRoutes);

}

/* ---------- 404 + Error ---------- */
app.use(notFound);
app.use(errorHandler);

module.exports = app;
