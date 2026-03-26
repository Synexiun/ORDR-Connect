// ORDR-Connect — Node.js Health Check for Distroless Runtime
// Used by orchestrators (K8s livenessProbe, ECS health check)
// No curl/wget available in distroless — pure Node.js HTTP check

import http from 'node:http';

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/health',
  method: 'GET',
  timeout: 3000,
};

const req = http.request(options, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});

req.end();
