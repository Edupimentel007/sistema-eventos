import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lE8AAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eventos-media-'));
  const dbPath = join(dir, 'test.sqlite');
  const mediaRoot = join(dir, 'uploads');
  let app = createApp({ dbPath, mediaRoot });
  app.db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
    VALUES (?, 'Proprietária', 'dona-media@example.com', ?, 'owner', ?)`).run(
    randomUUID(), hashPassword('senha-segura-123'), new Date().toISOString());
  async function listen() {
    await new Promise(done => app.server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  let base = await listen();
  const request = async (method, path, body, cookie, binary = false) => {
    const response = await fetch(base + path, {
      method, headers: { ...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status:response.status, headers:response.headers,
      data:binary ? Buffer.from(await response.arrayBuffer()) : await response.json(),
      cookie:response.headers.get('set-cookie')?.split(';')[0] };
  };
  const stop = async () => { await new Promise(done => app.server.close(done)); app.db.close(); };
  const restart = async () => { await stop(); app = createApp({ dbPath, mediaRoot }); base = await listen(); };
  const cleanup = async () => {
    await stop();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório de teste inválido.');
    rmSync(dir, {recursive:true,force:true});
  };
  return {request,restart,cleanup,mediaRoot,database:()=>app.db};
}

const eventBody = (clientIds, name) => ({ name,type:'casamento',status:'contratado',
  startAt:'2027-06-19T19:00:00.000Z',timezone:'America/Sao_Paulo',clientIds });

async function accept(f, owner, eventId, clientId, password) {
  const invite = await f.request('POST', `/api/events/${eventId}/invitations`, {clientId}, owner);
  assert.equal(invite.status, 201);
  const token = new URL(invite.data.inviteUrl).searchParams.get('token');
  const user = await f.request('POST', '/api/invitations/accept', {token,password});
  assert.equal(user.status, 200);
  return user.cookie;
}

test('inspirações e contratos usam arquivos privados com isolamento por cliente e evento', async () => {
  const f = await fixture();
  try {
    const login = await f.request('POST','/api/auth/login',
      {email:'dona-media@example.com',password:'senha-segura-123'});
    const owner = login.cookie;
    const ana = (await f.request('POST','/api/clients',
      {name:'Ana',email:'ana-media@example.com'},owner)).data.client;
    const lucas = (await f.request('POST','/api/clients',
      {name:'Lucas',email:'lucas-media@example.com'},owner)).data.client;
    const bia = (await f.request('POST','/api/clients',
      {name:'Bia',email:'bia-media@example.com'},owner)).data.client;
    const event = (await f.request('POST','/api/events',
      eventBody([ana.id,lucas.id],'Casamento Ana e Lucas'),owner)).data.event;
    const other = (await f.request('POST','/api/events',
      eventBody([bia.id],'Evento Bia'),owner)).data.event;
    const anaCookie = await accept(f,owner,event.id,ana.id,'senha-ana-media-123');
    const lucasCookie = await accept(f,owner,event.id,lucas.id,'senha-lucas-media-123');
    const biaCookie = await accept(f,owner,other.id,bia.id,'senha-bia-media-123');

    const inspirationBody = {filename:'referencia.png',mimeType:'image/png',
      contentBase64:png.toString('base64'),title:'Paleta de flores',note:'Gostei destas cores'};
    const shared = await f.request('POST',`/api/media/events/${event.id}/inspirations`,
      {...inspirationBody,visibility:'event'},anaCookie);
    assert.equal(shared.status,201);
    const privateOne = await f.request('POST',`/api/media/events/${event.id}/inspirations`,
      {...inspirationBody,title:'Surpresa da noiva',visibility:'client'},anaCookie);
    assert.equal(privateOne.status,201);
    const internal = await f.request('POST',`/api/media/events/${event.id}/inspirations`,
      {...inspirationBody,title:'Nota reservada',visibility:'internal'},owner);
    assert.equal(internal.status,201);
    assert.deepEqual((await f.request('GET',`/api/media/events/${event.id}/inspirations`,undefined,anaCookie))
      .data.inspirations.map(i=>i.title).sort(),['Paleta de flores','Surpresa da noiva']);
    assert.deepEqual((await f.request('GET',`/api/media/events/${event.id}/inspirations`,undefined,lucasCookie))
      .data.inspirations.map(i=>i.title),['Paleta de flores']);
    assert.equal((await f.request('GET',`/api/media/files/${privateOne.data.inspiration.id}`,undefined,lucasCookie)).status,404);
    assert.equal((await f.request('GET',`/api/media/files/${internal.data.inspiration.id}`,undefined,anaCookie)).status,404);
    assert.equal((await f.request('GET',`/api/media/events/${event.id}/inspirations`,undefined,biaCookie)).status,404);
    assert.equal((await f.request('POST',`/api/media/events/${event.id}/inspirations`,
      {...inspirationBody,visibility:'internal'},anaCookie)).status,422);
    assert.equal((await f.request('POST',`/api/media/events/${event.id}/inspirations`,
      {...inspirationBody,contentBase64:Buffer.from('falso').toString('base64')},anaCookie)).status,422);

    const contractBody = {filename:'contrato.pdf',mimeType:'application/pdf',
      contentBase64:pdf.toString('base64'),title:'Contrato de decoração',
      signatureStatus:'pending',sharedWithClient:true};
    const contractAna = await f.request('POST',`/api/media/events/${event.id}/contracts`,
      {...contractBody,clientId:ana.id},owner);
    assert.equal(contractAna.status,201);
    assert.equal(contractAna.data.contract.version,1);
    const contractLucas = await f.request('POST',`/api/media/events/${event.id}/contracts`,
      {...contractBody,clientId:lucas.id,sharedWithClient:false,title:'Contrato Lucas'},owner);
    assert.equal(contractLucas.status,201);
    assert.deepEqual((await f.request('GET',`/api/media/events/${event.id}/contracts`,undefined,anaCookie))
      .data.contracts.map(c=>c.title),['Contrato de decoração']);
    assert.deepEqual((await f.request('GET',`/api/media/events/${event.id}/contracts`,undefined,lucasCookie))
      .data.contracts,[]);
    assert.equal((await f.request('GET',`/api/media/files/${contractLucas.data.contract.id}`,undefined,anaCookie)).status,404);
    assert.equal((await f.request('GET',`/api/media/files/${contractLucas.data.contract.id}`,undefined,lucasCookie)).status,404);
    const download = await f.request('GET',`/api/media/files/${contractAna.data.contract.id}`,
      undefined,anaCookie,true);
    assert.equal(download.status,200);
    assert.equal(download.data.equals(pdf),true);
    assert.match(download.headers.get('content-disposition'),/^attachment;/);
    assert.equal(download.headers.get('cache-control'),'private, no-store');
    assert.equal((await f.request('POST',`/api/media/events/${event.id}/contracts`,
      {...contractBody,clientId:ana.id},anaCookie)).status,404);
    assert.equal((await f.request('POST',`/api/media/events/${event.id}/contracts`,
      {...contractBody,clientId:bia.id},owner)).status,422);
    const release = await f.request('PATCH',`/api/media/contracts/${contractLucas.data.contract.id}`,
      {sharedWithClient:true,signatureStatus:'signed_manual'},owner);
    assert.equal(release.status,200);
    assert.equal(release.data.contract.signatureStatus,'signed_manual');
    assert.deepEqual((await f.request('GET',`/api/media/events/${event.id}/contracts`,undefined,lucasCookie))
      .data.contracts.map(c=>c.title),['Contrato Lucas']);
    assert.equal((await f.request('GET',`/api/media/files/${contractLucas.data.contract.id}`,undefined,lucasCookie,true)).status,200);
    assert.equal(readdirSync(f.mediaRoot).length,5);
    await f.restart();
    assert.equal((await f.request('GET',`/api/media/events/${event.id}/contracts`,undefined,anaCookie)).data.contracts.length,1);
    assert.equal((await f.request('GET',`/api/media/files/${contractAna.data.contract.id}`,undefined,anaCookie,true)).data.equals(pdf),true);
  } finally { await f.cleanup(); }
});

test('equipe vê arquivos apenas dos eventos vinculados e precisa de edição para enviar', async () => {
  const f = await fixture();
  try {
    const owner = (await f.request('POST','/api/auth/login',
      {email:'dona-media@example.com',password:'senha-segura-123'})).cookie;
    const first = (await f.request('POST','/api/events',eventBody([],'Evento A'),owner)).data.event;
    const second = (await f.request('POST','/api/events',eventBody([],'Evento B'),owner)).data.event;
    const teamId = randomUUID(); const timestamp = new Date().toISOString();
    f.database().prepare(`INSERT INTO users
      (id,name,email,password_hash,role,created_at) VALUES (?, 'Assistente', ?, ?, 'team', ?)`)
      .run(teamId,'assistente-media@example.com',hashPassword('senha-equipe-123'),timestamp);
    f.database().prepare(`INSERT INTO team_permissions
      (user_id,module,can_view,can_edit) VALUES (?, 'events', 1, 0)`).run(teamId);
    f.database().prepare('INSERT INTO event_team (event_id,user_id,created_at) VALUES (?, ?, ?)')
      .run(first.id,teamId,timestamp);
    const team = (await f.request('POST','/api/auth/login',
      {email:'assistente-media@example.com',password:'senha-equipe-123'})).cookie;
    assert.equal((await f.request('GET',`/api/media/events/${first.id}/inspirations`,undefined,team)).status,200);
    assert.equal((await f.request('GET',`/api/media/events/${second.id}/inspirations`,undefined,team)).status,404);
    const body = {filename:'flor.png',mimeType:'image/png',contentBase64:png.toString('base64')};
    assert.equal((await f.request('POST',`/api/media/events/${first.id}/inspirations`,body,team)).status,403);
    f.database().prepare(`UPDATE team_permissions SET can_edit = 1 WHERE user_id = ? AND module = 'events'`)
      .run(teamId);
    const sent = await f.request('POST',`/api/media/events/${first.id}/inspirations`,body,team);
    assert.equal(sent.status,201);
    assert.equal((await f.request('GET',`/api/media/files/${sent.data.inspiration.id}`,undefined,team,true)).status,200);
    assert.equal((await f.request('POST',`/api/media/events/${second.id}/inspirations`,body,team)).status,404);
  } finally { await f.cleanup(); }
});
