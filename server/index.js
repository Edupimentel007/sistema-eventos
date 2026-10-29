// Início: OWNER_EMAIL=... OWNER_PASSWORD=... npm run bootstrap:owner;
// depois: npm start. Variáveis: DATABASE_PATH (padrão data/events.sqlite),
// PORT (3000), HOST (127.0.0.1), APP_BASE_URL, COOKIE_SECURE=true sob HTTPS.
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');

const { server, db } = createApp();
server.listen(port, host, () => {
  console.log(`Sistema de eventos em http://${host}:${server.address().port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
