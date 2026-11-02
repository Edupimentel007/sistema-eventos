export function createMediaUi({ api, html, adminShell, portalShell, go, toast, esc, state, allowed, dateLabel }) {
  const mediaPath = eventId => `/api/media/events/${encodeURIComponent(eventId)}`;
  const adminPath = eventId => `/app/eventos/${encodeURIComponent(eventId)}/arquivos`;
  const portalPath = eventId => `/portal/eventos/${encodeURIComponent(eventId)}/arquivos`;
  const statusLabel = status => status === 'signed_manual' ? 'Assinado fora do sistema' : 'Assinatura pendente';
  const visibilityLabel = value => value === 'internal' ? 'Somente equipe' : value === 'client' ? 'Cliente específico' : 'Clientes do evento';

  function photoCards(items, empty) {
    if (!items?.length) return `<p>${empty}</p>`;
    return `<div class="media-gallery">${items.map(item => `<article class="media-card"><a class="media-photo" href="${esc(item.downloadUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(item.downloadUrl)}" alt="${esc(item.title || item.filename)}" loading="lazy"></a><div class="media-card-body"><strong>${esc(item.title || item.filename)}</strong><p>${esc(item.note || '')}</p><small>${esc(item.uploaderName || 'Equipe')} · ${dateLabel(item.createdAt)} · ${visibilityLabel(item.visibility)}</small><a class="text-link small" href="${esc(item.downloadUrl)}" target="_blank" rel="noopener noreferrer">Baixar foto</a></div></article>`).join('')}</div>`;
  }

  async function adminPage(eventId) {
    const [{event},ir,cr] = await Promise.all([
      api(`/api/events/${encodeURIComponent(eventId)}`),
      api(`${mediaPath(eventId)}/inspirations`),
      api(`${mediaPath(eventId)}/contracts`),
    ]);
    const clients = event.clients || [];
    const canUpload = allowed('events','write');
    const clientOptions = clients.map(client => `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join('');
    html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/eventos/${esc(eventId)}" data-nav="/app/eventos/${esc(eventId)}">← ${esc(event.name)}</a><div class="eyebrow section">Arquivos do evento</div><h1>Inspirações e contratos</h1><p>Referências visuais e documentos vinculados a cada cliente.</p></div></div>
      <div class="grid two"><section class="panel"><div class="panel-head"><h2>Fotos de inspiração</h2><span class="small">${ir.inspirations.length} foto${ir.inspirations.length===1?'':'s'}</span></div><p>Fotos enviadas pelos clientes ou pela equipe. Uma referência não altera o contrato.</p>${canUpload ? `<details class="filter-panel"><summary>Adicionar foto</summary><form data-form="media-inspiration" data-event-id="${esc(eventId)}"><div class="form-grid"><div class="field span-2"><label for="mi-photo">Foto JPG, PNG ou WebP (até 8 MB) *</label><input id="mi-photo" name="file" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="mi-title">Título</label><input id="mi-title" name="title" maxlength="160"></div><div class="field"><label for="mi-visibility">Quem pode ver</label><select id="mi-visibility" name="visibility"><option value="event">Clientes do evento</option><option value="client">Cliente específico</option><option value="internal">Somente equipe</option></select></div><div class="field"><label for="mi-client">Cliente específico</label><select id="mi-client" name="clientId"><option value="">Selecione se necessário</option>${clientOptions}</select></div><div class="field span-2"><label for="mi-note">Comentário</label><textarea id="mi-note" name="note" maxlength="2000"></textarea></div></div><div class="form-actions"><button class="button" type="submit">Enviar foto</button></div></form></details>` : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Contratos por cliente</h2><span class="small">${cr.contracts.length} documento${cr.contracts.length===1?'':'s'}</span></div><p>O upload registra um arquivo. Aprovação de orçamento e assinatura eletrônica são processos separados.</p>${canUpload ? `<details class="filter-panel"><summary>Subir contrato</summary>${clients.length ? `<form data-form="media-contract" data-event-id="${esc(eventId)}"><div class="form-grid"><div class="field"><label for="mc-client">Cliente *</label><select id="mc-client" name="clientId" required>${clientOptions}</select></div><div class="field"><label for="mc-title">Título *</label><input id="mc-title" name="title" maxlength="160" required placeholder="Contrato de decoração"></div><div class="field span-2"><label for="mc-file">Contrato PDF (até 12 MB) *</label><input id="mc-file" name="file" type="file" accept="application/pdf" required></div><div class="field"><label for="mc-status">Situação da assinatura</label><select id="mc-status" name="signatureStatus"><option value="pending">Assinatura pendente</option><option value="signed_manual">Assinado fora do sistema (arquivo enviado)</option></select></div><div class="field"><label class="check-option"><input name="sharedWithClient" type="checkbox"> Liberar no portal deste cliente</label></div></div><div class="form-actions"><button class="button" type="submit">Salvar contrato</button></div></form>` : '<p>Vincule um cliente ao evento antes de subir o contrato.</p>'}</details>` : ''}</section></div>
      <section class="panel section"><div class="panel-head"><h2>Galeria de inspirações</h2></div>${photoCards(ir.inspirations,'Nenhuma foto enviada ainda.')}</section>
      <section class="panel section"><div class="panel-head"><h2>Documentos</h2></div>${cr.contracts.length ? `<div class="contract-list">${cr.contracts.map(c => `<article class="contract-card"><div><strong>${esc(c.title)} · versão ${c.version}</strong><small>${esc(c.clientName)} · ${dateLabel(c.createdAt)} · ${statusLabel(c.signatureStatus)}</small><small>${c.sharedWithClient?'Visível no portal deste cliente':'Privado da equipe'}</small></div><a class="button secondary small" href="${esc(c.downloadUrl)}" target="_blank" rel="noopener noreferrer">Baixar PDF</a>${canUpload?`<details class="filter-panel"><summary>Editar acesso e situação</summary><form data-form="media-contract-update" data-id="${esc(c.id)}" data-event-id="${esc(eventId)}" class="form-grid"><div class="field"><label>Título</label><input name="title" maxlength="160" value="${esc(c.title)}" required></div><div class="field"><label>Situação</label><select name="signatureStatus"><option value="pending" ${c.signatureStatus==='pending'?'selected':''}>Assinatura pendente</option><option value="signed_manual" ${c.signatureStatus==='signed_manual'?'selected':''}>Assinado fora do sistema</option></select></div><div class="field span-2"><label class="check-option"><input name="sharedWithClient" type="checkbox" ${c.sharedWithClient?'checked':''}> Liberar no portal deste cliente</label></div><button class="button secondary" type="submit">Salvar alterações</button></form></details>`:''}</article>`).join('')}</div>`:'<p>Nenhum contrato cadastrado.</p>'}</section>`, '/app/eventos'));
  }

  async function portalPage(eventId) {
    const [{event},ir,cr] = await Promise.all([
      api(`/api/portal/events/${encodeURIComponent(eventId)}`),
      api(`${mediaPath(eventId)}/inspirations`),
      api(`${mediaPath(eventId)}/contracts`),
    ]);
    html(portalShell(`<a class="text-link small" href="/portal/eventos/${esc(eventId)}" data-nav="/portal/eventos/${esc(eventId)}">← ${esc(event.name)}</a><div class="page-head portal-section"><div><div class="eyebrow">Suas referências</div><h1>Inspirações e documentos</h1><p>Guarde aqui as imagens que ajudam a contar a história do seu evento.</p></div></div>
      <section class="panel portal-section"><div class="panel-head"><h2>Envie uma inspiração</h2></div><p>Uma foto é uma sugestão para a equipe. Ela não altera o escopo contratado automaticamente.</p><form data-form="media-inspiration" data-event-id="${esc(eventId)}" data-portal="true"><div class="form-grid"><div class="field span-2"><label for="pi-photo">Foto JPG, PNG ou WebP (até 8 MB) *</label><input id="pi-photo" name="file" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="pi-title">Título</label><input id="pi-title" name="title" maxlength="160" placeholder="Ex.: Flores para o altar"></div><div class="field"><label for="pi-visibility">Compartilhar com</label><select id="pi-visibility" name="visibility"><option value="event">Clientes do evento e equipe</option><option value="client">Somente eu e a equipe</option></select></div><div class="field span-2"><label for="pi-note">Comentário</label><textarea id="pi-note" name="note" maxlength="2000" placeholder="Conte o que mais gostou nesta imagem"></textarea></div></div><div class="form-actions"><button class="button" type="submit">Enviar inspiração</button></div></form></section>
      <section class="panel portal-section"><div class="panel-head"><h2>Fotos compartilhadas</h2></div>${photoCards(ir.inspirations,'Nenhuma inspiração foi enviada ainda.')}</section>
      <section class="panel portal-section"><div class="panel-head"><h2>Meus contratos</h2></div>${cr.contracts.length?`<div class="contract-list">${cr.contracts.map(c => `<div class="contract-card"><div><strong>${esc(c.title)} · versão ${c.version}</strong><small>${dateLabel(c.createdAt)} · ${statusLabel(c.signatureStatus)}</small></div><a class="button secondary small" href="${esc(c.downloadUrl)}" target="_blank" rel="noopener noreferrer">Baixar PDF</a></div>`).join('')}</div>`:'<p>A equipe ainda não liberou um contrato para sua conta.</p>'}<p class="small section">A consulta ao PDF não constitui assinatura eletrônica.</p></section>`));
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(file);
    });
  }

  async function handleForm(form) {
    const kind = form.dataset.form;
    if (!['media-inspiration','media-contract','media-contract-update'].includes(kind)) return false;
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      const data = new FormData(form);
      const eventId = form.dataset.eventId;
      if (kind === 'media-contract-update') {
        await api(`/api/media/contracts/${encodeURIComponent(form.dataset.id)}`, {
          method:'PATCH', body:JSON.stringify({title:String(data.get('title')||'').trim(),
            signatureStatus:data.get('signatureStatus'),sharedWithClient:data.has('sharedWithClient')}) });
        toast('Contrato atualizado.'); go(adminPath(eventId));
      } else {
        const file = form.querySelector('input[type="file"]')?.files?.[0];
        if (!file) throw new Error('Selecione um arquivo.');
        const max = kind === 'media-contract' ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
        if (file.size > max) throw new Error(`O arquivo deve ter no máximo ${kind === 'media-contract' ? 12 : 8} MB.`);
        const extension = file.name.split('.').pop()?.toLowerCase();
        const inferred = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'}[extension];
        const payload = { filename:file.name, mimeType:file.type || inferred || '', contentBase64:await readBase64(file) };
        if (kind === 'media-inspiration') {
          Object.assign(payload,{title:String(data.get('title')||'').trim(),note:String(data.get('note')||'').trim(),
            visibility:data.get('visibility'),clientId:data.get('clientId')||undefined});
          await api(`${mediaPath(eventId)}/inspirations`,{method:'POST',body:JSON.stringify(payload)});
          toast('Inspiração enviada.'); go(form.dataset.portal ? portalPath(eventId) : adminPath(eventId));
        } else {
          Object.assign(payload,{clientId:data.get('clientId'),title:String(data.get('title')||'').trim(),
            signatureStatus:data.get('signatureStatus'),sharedWithClient:data.has('sharedWithClient')});
          await api(`${mediaPath(eventId)}/contracts`,{method:'POST',body:JSON.stringify(payload)});
          toast('Contrato salvo.'); go(adminPath(eventId));
        }
      }
    } catch (error) { toast(error.message,true); }
    finally { if(button) button.disabled=false; }
    return true;
  }

  return { adminPage, portalPage, handleForm };
}
