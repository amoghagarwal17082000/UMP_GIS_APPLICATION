const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

if (!require.extensions['.ts']) {
  require.extensions['.ts'] = require.extensions['.js'];
}

const envName = process.env.NODE_ENV || 'development';
const envPath = path.join(__dirname, 'config', 'env', `${envName}.env`);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  throw new Error(`Environment file not found for NODE_ENV="${envName}" at ${envPath}`);
}

const app = require('./app');
const { configuration } = require('./config/configuration.ts');

const PORT = configuration().PORT;

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
