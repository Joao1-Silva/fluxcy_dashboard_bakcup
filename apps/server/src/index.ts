import basicAuth from 'basic-auth';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';

import { SERVER_CONFIG } from './lib/config.js';
import { apiRouter } from './routes/api.js';
import { assistantRouter } from './routes/assistant.js';
import { tasksRouter } from './routes/tasks.js';
import { initRealtime } from './socket/realtime.js';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

function authEnabled() {
  return SERVER_CONFIG.basicAuth.enabled;
}

function unauthorized(res: express.Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Fluxcy Dashboard"');
  return res.status(401).json({ message: 'Unauthorized' });
}

function apiAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!authEnabled()) {
    return next();
  }

  const credentials = basicAuth(req);
  if (!credentials) {
    return unauthorized(res);
  }

  if (
    credentials.name !== SERVER_CONFIG.basicAuth.user ||
    credentials.pass !== SERVER_CONFIG.basicAuth.pass
  ) {
    return unauthorized(res);
  }

  return next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.use('/api', apiAuthMiddleware, apiRouter);
app.use('/api/tasks', apiAuthMiddleware, tasksRouter);
app.use('/assistant', apiAuthMiddleware, assistantRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(500).json({ message });
});

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: true,
    credentials: false,
  },
});

io.use((socket, next) => {
  if (!authEnabled()) {
    return next();
  }

  const authHeader = socket.handshake.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) {
    return next(new Error('Unauthorized'));
  }

  const encoded = authHeader.split(' ')[1];
  if (!encoded) {
    return next(new Error('Unauthorized'));
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const [name, pass] = decoded.split(':');

  if (name !== SERVER_CONFIG.basicAuth.user || pass !== SERVER_CONFIG.basicAuth.pass) {
    return next(new Error('Unauthorized'));
  }

  return next();
});

const stopRealtime = initRealtime(io, SERVER_CONFIG.socketSnapshotMs);

httpServer.listen(SERVER_CONFIG.socketPort, () => {
  console.log(`Fluxcy BFF escuchando en http://localhost:${SERVER_CONFIG.socketPort}`);
});

process.on('SIGINT', () => {
  stopRealtime();
  io.close();
  httpServer.close(() => process.exit(0));
});


