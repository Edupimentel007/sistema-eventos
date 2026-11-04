import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('origem publica configurada passa pelo proxy sem liberar outras origens', async () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://eventos.exemplo.com';
  const app = createApp({ dbPath: ':memory:' });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${app.server.address().port}/api/auth/login`;
    const attempt = async origin => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: '{}',
      });
      return response.status;
    };
    assert.equal(await attempt('https://eventos.exemplo.com'), 422);
    assert.equal(await attempt('https://outro.exemplo.com'), 403);
  } finally {
    app.stopNotifications();
    await new Promise(resolve => app.server.close(resolve));
    app.db.close();
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});
