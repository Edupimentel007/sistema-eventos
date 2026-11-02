// Módulo de acervo e fornecedores. O servidor valida permissão, evento e arquivos.
export function createInventoryUi(ctx) {
  const { api, html, adminShell, go, toast, esc, state, allowed } = ctx;
  const brDate = (iso, tz = 'America/Sao_Paulo') => iso
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(iso))
    : 'A definir';
  const statusLabel = { reserved: 'Reservado', released: 'Liberado', completed: 'Concluído' };
  const ownershipLabel = { own: 'Próprio', rental: 'Alugado' };
  const routeItem = id => `/app/acervo/${encodeURIComponent(id)}`;
  const routeSupplier = id => `/app/fornecedores/${encodeURIComponent(id)}`;
  const routeEvent = id => `/app/eventos/${encodeURIComponent(id)}/acervo`;
  const dateParts = (iso, tz) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso)).filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}` };
  };
  const wallToIso = (date, time, tz) => {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    let utc = Date.UTC(y, m - 1, d, hh, mm);
    for (let n = 0; n < 3; n++) {
      const parts = dateParts(new Date(utc).toISOString(), tz);
      const [py, pm, pd] = parts.date.split('-').map(Number);
      const [ph, pmin] = parts.time.split(':').map(Number);
      utc += Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(py, pm - 1, pd, ph, pmin);
    }
    return new Date(utc).toISOString();
  };
  const qty = value => Number.isInteger(Number(value)) ? Number(value) : NaN;
  const offeringLines = offerings => (offerings || []).map(item =>
    [item.name, item.category, item.unit, item.notes].filter((part, index, arr) =>
      index === 0 || part || arr.slice(index + 1).some(Boolean)).join(' | ')).join('\n');
  const parseOfferings = raw => String(raw || '').split(/\r?\n/).map(line => line.trim())
    .filter(Boolean).map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length > 4 || !parts[0]) throw new Error('Use uma oferta por linha: nome | categoria | unidade | observação.');
      return { name: parts[0], category: parts[1] || '', unit: parts[2] || '', notes: parts[3] || '' };
    });

  function itemCard(item) {
    const photo = item.photos?.[0];
    return `<a class="inventory-card panel" href="${routeItem(item.id)}" data-nav="${routeItem(item.id)}">
      <span class="inventory-cover">${photo ? `<img src="${esc(photo.url)}" alt="${esc(item.name)}" loading="lazy">` : '<span aria-hidden="true">✻</span>'}</span>
      <span class="inventory-card-body"><strong>${esc(item.name)}</strong><small>${esc(item.category)} · ${esc(ownershipLabel[item.ownership] || item.ownership)}</small><span>Estoque: <b>${item.stockQty}</b> ${esc(item.unit)} · Disponível agora: <b>${item.availableNowQty}</b></span></span>
      <span class="text-link small">Abrir →</span></a>`;
  }

  async function inventoryPage() {
    const p = new URLSearchParams(location.search);
    const q = p.get('q') || ''; const category = p.get('category') || '';
    const params = new URLSearchParams(); if (q) params.set('q', q); if (category) params.set('category', category);
    const [result, eventsResult] = await Promise.all([
      api(`/api/inventory/items${params.size ? `?${params}` : ''}`), api('/api/inventory/events'),
    ]);
    const items = result.items || []; const events = eventsResult.events || [];
    html(adminShell(`<div class="page-head"><div><div class="eyebrow">Operação</div><h1>Mobiliário e acervo</h1><p>Itens próprios e alugados, fotos, estoque e reservas por evento.</p></div><div class="page-actions">${allowed('inventory', 'write') ? `<a class="button" href="/app/acervo/novo" data-nav="/app/acervo/novo">+ Novo item</a>` : ''}</div></div>
      <div class="inventory-subnav"><a href="/app/acervo" data-nav="/app/acervo" class="active">Itens</a><a href="/app/acervo/reservas" data-nav="/app/acervo/reservas">Reservas</a>${allowed('suppliers') ? '<a href="/app/fornecedores" data-nav="/app/fornecedores">Fornecedores</a>' : ''}</div>
      <form class="filters" data-form="inventory-filters"><div class="field search"><label for="inv-q">Buscar</label><input id="inv-q" name="q" value="${esc(q)}" placeholder="Nome, categoria ou fornecedor"></div><div class="field"><label for="inv-category">Categoria</label><select id="inv-category" name="category"><option value="">Todas</option>${[...new Set(items.map(item => item.category))].map(c => `<option value="${esc(c)}" ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div><button class="button secondary" type="submit">Filtrar</button></form>
      ${items.length ? `<div class="inventory-grid">${items.map(itemCard).join('')}</div>` : `<div class="empty-card"><h2>${params.size ? 'Nenhum item encontrado' : 'Cadastre seu primeiro item'}</h2><p>${params.size ? 'Altere os filtros para encontrar outros itens.' : 'Registre móveis, vasos, suportes e materiais usados nos eventos.'}</p>${allowed('inventory', 'write') ? '<a class="button" href="/app/acervo/novo" data-nav="/app/acervo/novo">Cadastrar item</a>' : ''}</div>`}
      ${events.length ? `<section class="panel section"><div class="panel-head"><h2>Reservas por evento</h2></div><div class="list">${events.slice(0, 6).map(event => `<a class="list-row" href="${routeEvent(event.id)}" data-nav="${routeEvent(event.id)}"><span class="row-body"><strong>${esc(event.name)}</strong><span>${esc(event.code)} · ${brDate(event.startAt, event.timezone)}</span></span><span class="text-link small">Abrir →</span></a>`).join('')}</div></section>` : ''}`, '/app/acervo'));
  }

  function itemForm(item, suppliers, editing) {
    return `<form class="panel" data-form="${editing ? 'inventory-update' : 'inventory-create'}" data-id="${esc(item?.id || '')}"><div class="form-grid">
      <div class="field span-2"><label for="item-name">Nome *</label><input id="item-name" name="name" required maxlength="160" value="${esc(item?.name || '')}" placeholder="Ex.: Cadeira de madeira"></div>
      <div class="field"><label for="item-category">Categoria *</label><input id="item-category" name="category" required maxlength="80" value="${esc(item?.category || '')}" list="inventory-categories" placeholder="Mobiliário, vaso, suporte..."><datalist id="inventory-categories"><option value="Mesas"><option value="Cadeiras"><option value="Sofás"><option value="Vasos"><option value="Suportes"><option value="Decoração"><option value="Estruturas"><option value="Outros"></datalist></div>
      <div class="field"><label for="item-ownership">Origem</label><select id="item-ownership" name="ownership"><option value="own" ${item?.ownership !== 'rental' ? 'selected' : ''}>Próprio</option><option value="rental" ${item?.ownership === 'rental' ? 'selected' : ''}>Alugado</option></select></div>
      <div class="field"><label for="item-unit">Unidade</label><input id="item-unit" name="unit" maxlength="40" value="${esc(item?.unit || 'unidade')}"></div>
      <div class="field"><label for="item-supplier">Fornecedor</label><select id="item-supplier" name="supplierId"><option value="">Não vinculado</option>${suppliers.map(s => `<option value="${esc(s.id)}" ${item?.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="item-dimensions">Medidas</label><input id="item-dimensions" name="dimensions" maxlength="120" value="${esc(item?.dimensions || '')}" placeholder="Ex.: 45 × 90 cm"></div>
      ${editing ? `<div class="field"><label for="item-active">Situação</label><select id="item-active" name="active"><option value="true" ${item.active ? 'selected' : ''}>Ativo</option><option value="false" ${!item.active ? 'selected' : ''}>Arquivado</option></select></div>` : `<div class="field"><label for="item-stock">Quantidade inicial *</label><input id="item-stock" name="stockQty" type="number" min="0" step="1" value="0" required><small>Depois, ajuste o estoque por movimentações.</small></div>`}
      <div class="field span-2"><label for="item-description">Descrição e observações</label><textarea id="item-description" name="description" maxlength="3000">${esc(item?.description || '')}</textarea></div>
    </div><div class="form-actions"><a class="button secondary" href="${editing ? routeItem(item.id) : '/app/acervo'}" data-nav="${editing ? routeItem(item.id) : '/app/acervo'}">Cancelar</a><button class="button" type="submit">${editing ? 'Salvar item' : 'Cadastrar item'}</button></div></form>`;
  }

  async function inventoryNewPage() {
    if (!allowed('inventory', 'write')) throw new Error('Você não pode cadastrar itens.');
    const { suppliers } = await api('/api/inventory/suppliers');
    html(adminShell(`<div class="page-head"><div><div class="eyebrow">Mobiliário e acervo</div><h1>Novo item</h1><p>Cadastre o item e a quantidade disponível para os eventos.</p></div></div>${itemForm(null, suppliers || [], false)}`, '/app/acervo'));
  }

  async function inventoryItemPage(id) {
    const [result, suppliersResult, eventsResult] = await Promise.all([
      api(`/api/inventory/items/${encodeURIComponent(id)}`), api('/api/inventory/suppliers'),
      api('/api/inventory/events'),
    ]);
    const { item } = result; const movements = result.movements || [];
    const reservations = result.reservations || []; const write = allowed('inventory', 'write');
    const events = eventsResult.events || [];
    html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/acervo" data-nav="/app/acervo">← Acervo</a><div class="eyebrow section">${esc(item.category)} · ${esc(ownershipLabel[item.ownership] || item.ownership)}</div><h1>${esc(item.name)}</h1><p>${esc(item.description || 'Sem descrição adicional.')}</p></div></div>
      <section class="grid four finance-summary"><div><span>Em estoque</span><strong>${item.stockQty} ${esc(item.unit)}</strong></div><div><span>Reservado agora</span><strong>${item.reservedNowQty}</strong></div><div><span>Disponível agora</span><strong>${item.availableNowQty}</strong></div><div><span>Fornecedor</span><strong>${esc(item.supplierName || 'Não vinculado')}</strong></div></section>
      <div class="grid two section"><section class="panel"><div class="panel-head"><h2>Fotos do item</h2></div>${item.photos?.length ? `<div class="inventory-photo-grid">${item.photos.map(photo => `<div class="inventory-photo"><img src="${esc(photo.url)}" alt="${esc(item.name)}" loading="lazy">${write ? `<button type="button" class="button ghost small" data-inv-action="archive-photo" data-item-id="${esc(item.id)}" data-photo-id="${esc(photo.id)}">Remover foto</button>` : ''}</div>`).join('')}</div>` : '<p>Nenhuma foto cadastrada.</p>'}${write ? `<form class="form-section" data-form="inventory-photo" data-id="${esc(item.id)}"><div class="field"><label for="item-photo">Adicionar foto</label><input id="item-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp" required><small>JPEG, PNG ou WebP; até 8 MB. Foto acessível somente à equipe autorizada.</small></div><button class="button secondary" type="submit" style="margin-top:10px">Enviar foto</button></form>` : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Detalhes</h2></div><dl class="facts"><div class="fact"><dt>Medidas</dt><dd>${esc(item.dimensions || 'Não informado')}</dd></div><div class="fact"><dt>Origem</dt><dd>${esc(ownershipLabel[item.ownership] || item.ownership)}</dd></div><div class="fact"><dt>Situação</dt><dd>${item.active ? 'Ativo' : 'Arquivado'}</dd></div></dl>${write ? `<details class="section"><summary class="text-link">Editar item</summary><div class="section">${itemForm(item, suppliersResult.suppliers || [], true)}</div></details>` : ''}</section></div>
      <div class="grid two section"><section class="panel"><div class="panel-head"><h2>Movimentações de estoque</h2></div>${movements.length ? `<div class="list">${movements.map(move => `<div class="list-row"><span class="row-body"><strong>${move.type === 'in' ? 'Entrada' : 'Baixa'} de ${move.quantity} ${esc(item.unit)}</strong><span>${esc(move.reason)}${move.eventName ? ` · ${esc(move.eventName)}` : ''} · ${brDate(move.createdAt)}</span></span></div>`).join('')}</div>` : '<p>Nenhuma movimentação.</p>'}${write ? `<form class="form-section" data-form="inventory-movement" data-id="${esc(item.id)}"><h3>Registrar entrada ou baixa</h3><div class="form-grid"><div class="field"><label>Movimento</label><select name="type"><option value="in">Entrada</option><option value="out">Baixa</option></select></div><div class="field"><label>Quantidade *</label><input name="quantity" type="number" min="1" step="1" required></div><div class="field span-2"><label>Motivo *</label><input name="reason" maxlength="300" required placeholder="Ex.: Compra, avaria ou perda"></div><div class="field span-2"><label>Evento relacionado</label><select name="eventId"><option value="">Nenhum</option>${events.map(event => `<option value="${esc(event.id)}">${esc(event.name)}</option>`).join('')}</select></div></div><button class="button" type="submit" style="margin-top:12px">Registrar movimento</button></form>` : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Reservas</h2><a class="text-link small" href="/app/acervo/reservas?itemId=${encodeURIComponent(item.id)}" data-nav="/app/acervo/reservas?itemId=${encodeURIComponent(item.id)}">Todas →</a></div>${reservations.length ? `<div class="list">${reservations.slice(0, 8).map(reservation => `<a class="list-row" href="${routeEvent(reservation.eventId)}" data-nav="${routeEvent(reservation.eventId)}"><span class="row-body"><strong>${esc(reservation.eventName)} · ${reservation.quantity} ${esc(item.unit)}</strong><span>${brDate(reservation.startAt)} a ${brDate(reservation.endAt)} · ${esc(statusLabel[reservation.status])}</span></span></a>`).join('')}</div>` : '<p>Nenhuma reserva para este item.</p>'}</section></div>`, '/app/acervo'));
  }

  function reservationRow(reservation, write) {
    return `<div class="inventory-reservation"><div><strong>${esc(reservation.itemName)} · ${reservation.quantity} ${esc(reservation.itemUnit)}</strong><small>${esc(reservation.eventName)} · ${brDate(reservation.startAt)} a ${brDate(reservation.endAt)}</small><small>${esc(statusLabel[reservation.status] || reservation.status)}${reservation.notes ? ` · ${esc(reservation.notes)}` : ''}</small></div>${write && reservation.status === 'reserved' ? `<div class="page-actions"><button type="button" class="button secondary small" data-inv-action="release-reservation" data-id="${esc(reservation.id)}">Liberar</button><button type="button" class="button ghost small" data-inv-action="complete-reservation" data-id="${esc(reservation.id)}">Concluir</button></div>` : ''}</div>`;
  }

  async function reservationsPage() {
    const p = new URLSearchParams(location.search); const eventId = p.get('eventId') || '';
    const itemId = p.get('itemId') || '';
    const query = new URLSearchParams(); if (eventId) query.set('eventId', eventId);
    if (itemId) query.set('itemId', itemId);
    const [rr, er, ir] = await Promise.all([
      api(`/api/inventory/reservations${query.size ? `?${query}` : ''}`),
      api('/api/inventory/events'), api('/api/inventory/items'),
    ]);
    const events = er.events || []; const items = ir.items || [];
    html(adminShell(`<div class="page-head"><div><div class="eyebrow">Mobiliário e acervo</div><h1>Reservas</h1><p>Período de retirada, montagem, uso e devolução dos itens.</p></div></div>
      <div class="inventory-subnav"><a href="/app/acervo" data-nav="/app/acervo">Itens</a><a class="active" href="/app/acervo/reservas" data-nav="/app/acervo/reservas">Reservas</a></div>
      <form class="filters" data-form="inventory-reservation-filters"><div class="field"><label>Evento</label><select name="eventId"><option value="">Todos</option>${events.map(e => `<option value="${esc(e.id)}" ${eventId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div><div class="field"><label>Item</label><select name="itemId"><option value="">Todos</option>${items.map(item => `<option value="${esc(item.id)}" ${itemId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><button class="button secondary" type="submit">Filtrar</button></form>
      ${(rr.reservations || []).length ? `<div class="panel inventory-reservations">${rr.reservations.map(r => reservationRow(r, allowed('inventory', 'write'))).join('')}</div>` : '<div class="empty-card"><h2>Nenhuma reserva encontrada</h2><p>Abra um evento para selecionar os itens e registrar o período de uso.</p></div>'}
      ${events.length ? `<section class="panel section"><h2>Reservar para um evento</h2><div class="inventory-event-links">${events.slice(0, 12).map(e => `<a class="button secondary" href="${routeEvent(e.id)}" data-nav="${routeEvent(e.id)}">${esc(e.name)}</a>`).join('')}</div></section>` : ''}`, '/app/acervo'));
  }

  async function eventInventoryPage(id) {
    const [er, rr, ir] = await Promise.all([
      api('/api/inventory/events'),
      api(`/api/inventory/reservations?eventId=${encodeURIComponent(id)}`),
      api('/api/inventory/items'),
    ]);
    const event = (er.events || []).find(e => e.id === id);
    if (!event) throw new Error('Evento não encontrado ou sem acesso.');
    const items = (ir.items || []).filter(item => item.active && item.stockQty > 0);
    const tz = event.timezone || state.config.defaultTimezone || 'America/Sao_Paulo';
    const start = dateParts(event.startAt, tz);
    const end = dateParts(event.endAt || new Date(new Date(event.startAt).getTime() + 24 * 3600000).toISOString(), tz);
    html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/acervo" data-nav="/app/acervo">← Acervo</a><div class="eyebrow section">${esc(event.code)} · Fuso ${esc(tz)}</div><h1>Itens de ${esc(event.name)}</h1><p>Reserve quantidades para o período completo, incluindo transporte e devolução.</p></div></div>
      <section class="panel"><div class="panel-head"><h2>Reservas do evento</h2><span class="small">${(rr.reservations || []).length} registro(s)</span></div>${(rr.reservations || []).length ? `<div class="inventory-reservations">${rr.reservations.map(r => reservationRow(r, allowed('inventory', 'write'))).join('')}</div>` : '<p>Não há itens reservados para este evento.</p>'}</section>
      ${allowed('inventory', 'write') ? `<section class="panel section"><h2>Adicionar item</h2>${items.length ? `<form data-form="inventory-reservation-create" data-event-id="${esc(event.id)}" data-timezone="${esc(tz)}"><div class="form-grid"><div class="field span-2"><label for="reserve-item">Item *</label><select id="reserve-item" name="itemId" required><option value="">Selecione</option>${items.map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${item.stockQty} ${esc(item.unit)} em estoque</option>`).join('')}</select></div><div class="field"><label for="reserve-qty">Quantidade *</label><input id="reserve-qty" name="quantity" type="number" min="1" step="1" required></div><div class="field"><label>Fuso do compromisso</label><input value="${esc(tz)}" readonly></div><div class="field"><label for="reserve-start-date">Retirada / início *</label><input id="reserve-start-date" name="startDate" type="date" value="${start.date}" required></div><div class="field"><label for="reserve-start-time">Horário *</label><input id="reserve-start-time" name="startTime" type="time" value="08:00" required></div><div class="field"><label for="reserve-end-date">Devolução / fim *</label><input id="reserve-end-date" name="endDate" type="date" value="${end.date}" required></div><div class="field"><label for="reserve-end-time">Horário *</label><input id="reserve-end-time" name="endTime" type="time" value="18:00" required></div><div class="field span-2"><label for="reserve-notes">Observações</label><textarea id="reserve-notes" name="notes" maxlength="1000"></textarea></div></div><div class="form-actions"><button class="button" type="submit">Reservar item</button></div></form>` : '<p>Cadastre itens ativos com estoque antes de reservar.</p>'}</section>` : ''}`, '/app/acervo'));
  }

  function supplierForm(supplier, editing) {
    return `<form class="panel" data-form="${editing ? 'supplier-update' : 'supplier-create'}" data-id="${esc(supplier?.id || '')}"><div class="form-grid"><div class="field span-2"><label for="supplier-name">Nome *</label><input id="supplier-name" name="name" required maxlength="160" value="${esc(supplier?.name || '')}"></div><div class="field"><label for="supplier-category">Categoria</label><input id="supplier-category" name="category" maxlength="80" value="${esc(supplier?.category || '')}" placeholder="Ex.: Flores, mobiliário"></div><div class="field"><label for="supplier-contact">Pessoa de contato</label><input id="supplier-contact" name="contactName" maxlength="120" value="${esc(supplier?.contactName || '')}"></div><div class="field"><label for="supplier-email">E-mail</label><input id="supplier-email" name="email" type="email" maxlength="254" value="${esc(supplier?.email || '')}"></div><div class="field"><label for="supplier-phone">Telefone</label><input id="supplier-phone" name="phone" type="tel" maxlength="40" value="${esc(supplier?.phone || '')}"></div><div class="field span-2"><label for="supplier-site">Site HTTPS</label><input id="supplier-site" name="website" type="url" maxlength="2048" value="${esc(supplier?.website || '')}" placeholder="https://..."></div><div class="field span-2"><label for="supplier-offerings">O que disponibiliza</label><textarea id="supplier-offerings" name="offerings" rows="5" placeholder="Cadeiras de madeira | Mobiliário | unidade\nRosas brancas | Flores | maço">${esc(offeringLines(supplier?.offerings))}</textarea><small>Uma linha por produto ou serviço: nome | categoria | unidade | observação.</small></div><div class="field span-2"><label for="supplier-notes">Observações internas</label><textarea id="supplier-notes" name="notes" maxlength="3000">${esc(supplier?.notes || '')}</textarea></div>${editing ? `<div class="field"><label for="supplier-active">Situação</label><select id="supplier-active" name="active"><option value="true" ${supplier.active ? 'selected' : ''}>Ativo</option><option value="false" ${!supplier.active ? 'selected' : ''}>Inativo</option></select></div>` : ''}</div><div class="form-actions"><a class="button secondary" href="${editing ? routeSupplier(supplier.id) : '/app/fornecedores'}" data-nav="${editing ? routeSupplier(supplier.id) : '/app/fornecedores'}">Cancelar</a><button class="button" type="submit">${editing ? 'Salvar fornecedor' : 'Cadastrar fornecedor'}</button></div></form>`;
  }

  async function suppliersPage() {
    const p = new URLSearchParams(location.search); const q = p.get('q') || '';
    const { suppliers } = await api(`/api/suppliers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    const list = suppliers || [];
    html(adminShell(`<div class="page-head"><div><div class="eyebrow">Parceiros</div><h1>Fornecedores</h1><p>Contatos e produtos ou serviços disponíveis para os eventos.</p></div>${allowed('suppliers', 'write') ? '<a class="button" href="/app/fornecedores/novo" data-nav="/app/fornecedores/novo">+ Novo fornecedor</a>' : ''}</div><div class="inventory-subnav"><a href="/app/acervo" data-nav="/app/acervo">Acervo</a><a class="active" href="/app/fornecedores" data-nav="/app/fornecedores">Fornecedores</a></div><form class="filters" data-form="supplier-filters"><div class="field search"><label for="supplier-search">Buscar</label><input id="supplier-search" name="q" value="${esc(q)}" placeholder="Nome, categoria ou produto"></div><button class="button secondary" type="submit">Buscar</button></form>${list.length ? `<div class="inventory-grid">${list.map(s => `<a class="panel inventory-card" href="${routeSupplier(s.id)}" data-nav="${routeSupplier(s.id)}"><span class="inventory-card-body"><strong>${esc(s.name)}</strong><small>${esc(s.category || 'Categoria a definir')} · ${s.active ? 'Ativo' : 'Inativo'}</small><span>${esc(s.contactName || s.email || s.phone || 'Contato não informado')}</span><small>${(s.offerings || []).length} produto(s) ou serviço(s)</small></span><span class="text-link small">Abrir →</span></a>`).join('')}</div>` : `<div class="empty-card"><h2>${q ? 'Nenhum fornecedor encontrado' : 'Cadastre seus fornecedores'}</h2><p>Registre os contatos e o que cada parceiro disponibiliza.</p></div>`}`, '/app/fornecedores'));
  }

  async function supplierNewPage() {
    if (!allowed('suppliers', 'write')) throw new Error('Você não pode cadastrar fornecedores.');
    html(adminShell(`<div class="page-head"><div><div class="eyebrow">Fornecedores</div><h1>Novo fornecedor</h1><p>Cadastre contato e produtos ou serviços oferecidos.</p></div></div>${supplierForm(null, false)}`, '/app/fornecedores'));
  }

  async function supplierPage(id) {
    const { supplier: s } = await api(`/api/suppliers/${encodeURIComponent(id)}`);
    const website = (() => { try { const value = new URL(s.website); return value.protocol === 'https:' ? value.href : ''; } catch { return ''; } })();
    html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/fornecedores" data-nav="/app/fornecedores">← Fornecedores</a><div class="eyebrow section">${esc(s.category || 'Parceiro')} · ${s.active ? 'Ativo' : 'Inativo'}</div><h1>${esc(s.name)}</h1><p>${esc(s.contactName || 'Contato a definir')}</p></div></div><div class="grid two"><section class="panel"><h2>Contato</h2><dl class="facts"><div class="fact"><dt>E-mail</dt><dd>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : 'Não informado'}</dd></div><div class="fact"><dt>Telefone</dt><dd>${esc(s.phone || 'Não informado')}</dd></div><div class="fact"><dt>Site</dt><dd>${website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Abrir site ↗</a>` : 'Não informado'}</dd></div></dl><h3 class="section">Observações internas</h3><p>${esc(s.notes || 'Nenhuma observação.')}</p></section><section class="panel"><h2>O que disponibiliza</h2>${s.offerings?.length ? `<div class="list">${s.offerings.map(o => `<div class="list-row"><span class="row-body"><strong>${esc(o.name)}</strong><span>${esc([o.category, o.unit, o.notes].filter(Boolean).join(' · '))}</span></span></div>`).join('')}</div>` : '<p>Nenhum produto ou serviço cadastrado.</p>'}</section></div>${allowed('suppliers', 'write') ? `<section class="section"><details><summary class="text-link">Editar fornecedor</summary><div class="section">${supplierForm(s, true)}</div></details></section>` : ''}`, '/app/fornecedores'));
  }

  async function handleForm(form) {
    const kind = form?.dataset?.form || '';
    if (!['inventory-filters', 'inventory-reservation-filters', 'inventory-create',
      'inventory-update', 'inventory-movement', 'inventory-reservation-create',
      'inventory-photo', 'supplier-filters', 'supplier-create', 'supplier-update'].includes(kind)) return false;
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]'); if (button) button.disabled = true;
    try {
      if (kind === 'inventory-filters') {
        const p = new URLSearchParams();
        for (const key of ['q', 'category']) if (String(data.get(key) || '').trim())
          p.set(key, String(data.get(key)).trim());
        go(`/app/acervo${p.size ? `?${p}` : ''}`);
      } else if (kind === 'inventory-reservation-filters') {
        const p = new URLSearchParams();
        for (const key of ['eventId', 'itemId']) if (data.get(key)) p.set(key, data.get(key));
        go(`/app/acervo/reservas${p.size ? `?${p}` : ''}`);
      } else if (kind === 'supplier-filters') {
        const q = String(data.get('q') || '').trim();
        go(`/app/fornecedores${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      } else if (kind === 'inventory-create' || kind === 'inventory-update') {
        const editing = kind === 'inventory-update';
        const payload = { name: String(data.get('name') || '').trim(),
          category: String(data.get('category') || '').trim(),
          ownership: data.get('ownership'), unit: String(data.get('unit') || '').trim(),
          dimensions: String(data.get('dimensions') || '').trim(),
          description: String(data.get('description') || '').trim(),
          supplierId: data.get('supplierId') || null,
          ...(editing ? { active: data.get('active') === 'true' } :
            { stockQty: qty(data.get('stockQty')) }) };
        const result = await api(editing ? `/api/inventory/items/${encodeURIComponent(form.dataset.id)}` :
          '/api/inventory/items', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        toast(editing ? 'Item atualizado.' : 'Item cadastrado.'); go(routeItem(result.item.id));
      } else if (kind === 'inventory-movement') {
        await api(`/api/inventory/items/${encodeURIComponent(form.dataset.id)}/movements`, {
          method: 'POST', body: JSON.stringify({ type: data.get('type'),
            quantity: qty(data.get('quantity')), reason: String(data.get('reason') || '').trim(),
            eventId: data.get('eventId') || null }),
        });
        toast('Estoque atualizado.'); go(routeItem(form.dataset.id));
      } else if (kind === 'inventory-reservation-create') {
        const tz = form.dataset.timezone;
        const startsAt = wallToIso(data.get('startDate'), data.get('startTime'), tz);
        const endsAt = wallToIso(data.get('endDate'), data.get('endTime'), tz);
        await api('/api/inventory/reservations', { method: 'POST', body: JSON.stringify({
          itemId: data.get('itemId'), eventId: form.dataset.eventId,
          quantity: qty(data.get('quantity')), startAt: startsAt, endAt: endsAt,
          notes: String(data.get('notes') || '').trim(),
        }) });
        toast('Item reservado para o evento.'); go(routeEvent(form.dataset.eventId));
      } else if (kind === 'inventory-photo') {
        const file = form.elements.namedItem('photo')?.files?.[0];
        if (!file) throw new Error('Selecione uma foto.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Foto excede 8 MB.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
          throw new Error('Use foto JPEG, PNG ou WebP.');
        const response = await fetch(`/api/inventory/items/${encodeURIComponent(form.dataset.id)}/photos`, {
          method: 'POST', credentials: 'same-origin', headers: {
            'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name),
          }, body: file,
        });
        let result = {}; try { result = await response.json(); } catch { /* erro de rede */ }
        if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a foto.');
        toast('Foto adicionada.'); go(routeItem(form.dataset.id));
      } else if (kind === 'supplier-create' || kind === 'supplier-update') {
        const editing = kind === 'supplier-update';
        const payload = { name: String(data.get('name') || '').trim(),
          category: String(data.get('category') || '').trim(),
          contactName: String(data.get('contactName') || '').trim(),
          email: String(data.get('email') || '').trim(),
          phone: String(data.get('phone') || '').trim(),
          website: String(data.get('website') || '').trim(),
          notes: String(data.get('notes') || '').trim(),
          offerings: parseOfferings(data.get('offerings')),
          ...(editing ? { active: data.get('active') === 'true' } : {}) };
        const result = await api(editing ? `/api/suppliers/${encodeURIComponent(form.dataset.id)}` :
          '/api/suppliers', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        toast(editing ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
        go(routeSupplier(result.supplier.id));
      }
    } catch (error) { toast(error.message, true); }
    finally { if (button) button.disabled = false; }
    return true;
  }

  async function handleAction(button) {
    const action = button?.dataset?.invAction;
    if (!['archive-photo', 'release-reservation', 'complete-reservation'].includes(action)) return false;
    button.disabled = true;
    try {
      if (action === 'archive-photo') {
        await api(`/api/inventory/items/${encodeURIComponent(button.dataset.itemId)}/photos/${encodeURIComponent(button.dataset.photoId)}`,
          { method: 'DELETE' });
        toast('Foto removida do acervo.'); go(routeItem(button.dataset.itemId));
      } else {
        const status = action === 'release-reservation' ? 'released' : 'completed';
        await api(`/api/inventory/reservations/${encodeURIComponent(button.dataset.id)}`, {
          method: 'PATCH', body: JSON.stringify({ status }),
        });
        toast(status === 'released' ? 'Reserva liberada.' : 'Reserva concluída.');
        go(location.pathname + location.search);
      }
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
    return true;
  }

  return { inventoryPage, inventoryNewPage, inventoryItemPage, reservationsPage,
    eventInventoryPage, suppliersPage, supplierNewPage, supplierPage, handleForm, handleAction };
}
