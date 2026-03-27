const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

if (!require.extensions['.ts']) {
  require.extensions['.ts'] = require.extensions['.js'];
}

const envName = process.env.NODE_ENV || 'development';
const envPath = path.join(__dirname, './config/env', `${envName}.env`);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  throw new Error(`Environment file not found for NODE_ENV="${envName}" at ${envPath}`);
}

const app = require('./app');
const { configuration } = require('./config/configuration.ts');

function formatIstTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} IST`;
}


const PORT = configuration().PORT;

// app.listen(PORT, '127.0.0.1', () => {
//   console.log(`Server running on http://127.0.0.1:${PORT}`);
// });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${formatIstTimestamp()}] Server running on http://0.0.0.0:${PORT}`);
});
