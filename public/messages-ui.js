const statusLabels = {
  scheduled: 'Agendado', processing: 'Processando', sent: 'Enviado',
  failed: 'Falhou', cancelled: 'Cancelado',
};
const channelLabels = { internal: 'No portal', email: 'E-mail', whatsapp: 'WhatsApp' };
const occasionLabels = { event_start: 'Data do evento', installment_due: 'Vencimento de parcela' };
const allowedTokens = ['cliente', 'evento', 'data_evento', 'hora_evento', 'local', 'parcela_valor', 'vencimento'];
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
}).format(new Date(value)) : '—';
const timing = minutes => {
  const absolute = Math.abs(minutes);
  return { amount: absolute % 1440 === 0 ? absolute / 1440 : absolute / 60,
    unit: absolute % 1440 === 0 ? 'days' : 'hours', side: minutes < 0 ? 'before' : 'after' };
};

export function createMessagesUi({ api, html, adminShell, portalShell, go, toast, esc,
  state, allowed }) {
  const formMarkup = (rule = null) => {
    const time = timing(rule?.offsetMinutes ?? -1440);
    const name = rule?.name || '';
    return `<form class="panel message-rule-form" data-message-form="${rule ? 'update-rule' : 'create-rule'}"
      ${rule ? `data-id="${esc(rule.id)}"` : ''}>
      <div class="form-grid">
        <div class="field span-2"><label>Nome da automação *</label>
          <input name="name" required maxlength="120" value="${esc(name)}"
            placeholder="Ex.: Lembrete de casamento"></div>
        <div class="field"><label>Ocasião *</label><select name="occasion">
          ${Object.entries(occasionLabels).map(([value, label]) => `<option value="${value}"
            ${rule?.occasion === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="field"><label>Canal *</label><select name="channel">
          ${Object.entries(channelLabels).map(([value, label]) => `<option value="${value}"
            ${rule?.channel === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="field"><label>Quando *</label><div class="message-timing">
          <input name="timingAmount" type="number" min="0" max="8760" step="1" required
            value="${time.amount}">
          <select name="timingUnit"><option value="days" ${time.unit === 'days' ? 'selected' : ''}>dias</option>
            <option value="hours" ${time.unit === 'hours' ? 'selected' : ''}>horas</option></select>
          <select name="timingSide"><option value="before" ${time.side === 'before' ? 'selected' : ''}>antes</option>
            <option value="after" ${time.side === 'after' ? 'selected' : ''}>depois</option></select>
        </div></div>
        <div class="field"><label>Horário local da parcela</label><input name="sendTime" type="time"
          value="${esc(rule?.sendTime || '09:00')}">
          <small>Para mensagens relativas ao vencimento. Usa o fuso do evento.</small></div>
        <div class="field"><label>Tipo de evento</label><select name="eventType">
          <option value="">Todos</option>
          ${[['casamento', 'Casamento'], ['aniversario', 'Aniversário'],
            ['corporativo', 'Corporativo'], ['outro', 'Outro']].map(([value, label]) =>
            `<option value="${value}" ${rule?.eventType === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="field"><label>Assunto do e-mail</label><input name="subjectTemplate"
          maxlength="180" value="${esc(rule?.subjectTemplate || '')}"
          placeholder="Lembrete: {evento}"></div>
        <div class="field span-2"><label>Mensagem *</label><textarea name="bodyTemplate" maxlength="4000"
          placeholder="Olá {cliente}, seu evento será em {data_evento}.">${esc(rule?.bodyTemplate || '')}</textarea>
          <small>Variáveis: ${allowedTokens.map(token => `{${token}}`).join(', ')}.</small></div>
        <div class="field"><label>Modelo aprovado no WhatsApp</label><input name="whatsappTemplateName"
          maxlength="160" value="${esc(rule?.whatsappTemplateName || '')}"
          placeholder="lembrete_evento"></div>
        <div class="field"><label>Idioma do modelo</label><input name="whatsappLanguage"
          maxlength="20" value="${esc(rule?.whatsappLanguage || 'pt_BR')}"></div>
        <div class="field span-2"><label>Variáveis do modelo WhatsApp, em ordem</label>
          <input name="whatsappVariables" value="${esc((rule?.whatsappVariables || []).join(', '))}"
            placeholder="cliente, evento, data_evento">
          <small>O texto enviado no WhatsApp vem do modelo aprovado pela Meta. Informe as variáveis na mesma ordem.</small></div>
        <div class="field span-2"><label class="check-option"><input name="active" type="checkbox"
          ${rule?.active !== false ? 'checked' : ''}> Automação ativa</label></div>
      </div><div class="form-actions"><button class="button" type="submit">
        ${rule ? 'Salvar automação' : 'Criar automação'}</button></div>
    </form>`;
  };
  function payload(form) {
    const data = new FormData(form);
    const amount = Number(data.get('timingAmount'));
    const minutes = amount * (data.get('timingUnit') === 'days' ? 1440 : 60) *
      (data.get('timingSide') === 'before' ? -1 : 1);
    return {
      name: String(data.get('name') || '').trim(), occasion: data.get('occasion'),
      channel: data.get('channel'), offsetMinutes: minutes,
      sendTime: data.get('sendTime') || '09:00', eventType: data.get('eventType') || '',
      subjectTemplate: String(data.get('subjectTemplate') || '').trim(),
      bodyTemplate: String(data.get('bodyTemplate') || '').trim(),
      whatsappTemplateName: String(data.get('whatsappTemplateName') || '').trim(),
      whatsappLanguage: String(data.get('whatsappLanguage') || 'pt_BR').trim(),
      whatsappVariables: String(data.get('whatsappVariables') || '').split(',')
        .map(item => item.trim()).filter(Boolean), active: data.has('active'),
    };
  }
  const ruleCard = (rule, owner) => `<details class="panel message-rule-card">
    <summary><strong>${esc(rule.name)}</strong><span>${esc(occasionLabels[rule.occasion] || rule.occasion)} ·
      ${esc(channelLabels[rule.channel] || rule.channel)} ·
      ${rule.offsetMinutes < 0 ? 'antes' : 'depois'} ·
      ${rule.active ? 'Ativa' : 'Pausada'}</span></summary>
    ${owner ? formMarkup(rule) : `<p>${esc(rule.bodyTemplate || 'Modelo WhatsApp aprovado pela Meta.')}</p>`}
  </details>`;
  const jobCard = job => `<div class="panel message-job-card"><div class="message-job-top">
    <div><strong>${esc(job.clientName)} · ${esc(job.eventName)}</strong>
      <small>${esc(job.ruleName)} · ${esc(channelLabels[job.channel] || job.channel)}</small></div>
    <span class="badge message-${esc(job.status)}">${esc(statusLabels[job.status] || job.status)}</span>
  </div><p>${esc(job.body || job.subject || 'Modelo aprovado no provedor.')}</p>
  <div class="message-job-foot"><span>Agendado: ${dateTime(job.scheduledAt)}</span>
    ${job.sentAt ? `<span>Enviado: ${dateTime(job.sentAt)}</span>` : ''}
    ${job.deliveredAt ? `<span>Entrega confirmada: ${dateTime(job.deliveredAt)}</span>` : ''}
    ${job.lastError ? `<span class="message-error">${esc(job.lastError)}</span>` : ''}
    ${job.status === 'failed' && job.retrySafe && allowed('messages', 'write')
      ? `<button class="button secondary small" data-message-action="retry" data-id="${esc(job.id)}">Reprocessar</button>` : ''}
  </div></div>`;
  async function adminPage() {
    if (!allowed('messages')) throw new Error('Acesso não permitido.');
    const params = new URLSearchParams(location.search);
    const tab = ['rules', 'jobs', 'config'].includes(params.get('tab')) ? params.get('tab') : 'rules';
    const status = params.get('status') || '';
    const [rulesData, jobsData, config] = await Promise.all([
      api('/api/messages/rules'),
      api(`/api/messages/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
      api('/api/messages/config'),
    ]);
    const owner = state.user.role === 'owner';
    const rules = rulesData.rules || []; const jobs = jobsData.jobs || [];
    html(adminShell(`<div id="messages-page"><div class="page-head"><div>
      <div class="eyebrow">Relacionamento</div><h1>Mensagens automáticas</h1>
      <p>Escolha a ocasião, o canal e o texto. Confira cada envio na fila.</p></div>
      ${owner ? '<button class="button secondary" data-message-action="sync">Atualizar agendamentos</button>' : ''}
    </div><nav class="finance-tabs" aria-label="Seções de mensagens">
      <a href="/app/mensagens?tab=rules" data-nav="/app/mensagens?tab=rules" class="${tab === 'rules' ? 'active' : ''}">Automações</a>
      <a href="/app/mensagens?tab=jobs" data-nav="/app/mensagens?tab=jobs" class="${tab === 'jobs' ? 'active' : ''}">Fila e envios</a>
      <a href="/app/mensagens?tab=config" data-nav="/app/mensagens?tab=config" class="${tab === 'config' ? 'active' : ''}">Conectar canais</a>
    </nav>
    ${tab === 'rules' ? `<div class="grid two"><section><div class="section-title"><h2>Regras existentes</h2>
      <span class="small">${rules.length} regra${rules.length === 1 ? '' : 's'}</span></div>
      ${rules.length ? `<div class="message-rule-list">${rules.map(rule => ruleCard(rule, owner)).join('')}</div>`
        : '<div class="panel"><p>Nenhuma automação criada. Cadastre uma para agendar mensagens.</p></div>'}
      </section>${owner ? `<section><div class="section-title"><h2>Nova automação</h2></div>${formMarkup()}</section>` : ''}</div>
      <div class="notice section">Notificações no portal não precisam de serviço externo. E-mail e WhatsApp só são enviados quando o canal está configurado e o cliente autorizou o contato.</div>` : ''}
    ${tab === 'jobs' ? `<form class="filters" data-message-form="job-filter"><div class="field">
      <label for="message-status">Situação</label><select id="message-status" name="status">
        <option value="">Todas</option>${Object.entries(statusLabels).map(([value, label]) =>
          `<option value="${value}" ${status === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></div><button class="button secondary" type="submit">Filtrar</button></form>
      <div class="message-job-list">${jobs.length ? jobs.map(jobCard).join('')
        : '<div class="panel"><p>Nenhuma mensagem nesta situação.</p></div>'}</div>` : ''}
    ${tab === 'config' ? `<div class="grid two"><section class="panel"><h2>Notificações no portal</h2>
      <p>Disponíveis quando o cliente ativa o acesso. O cliente as vê em sua central de notificações.</p>
      <span class="badge paid">Pronto</span></section><section class="panel"><h2>E-mail pelo Resend</h2>
      <p>1. Verifique um domínio no Resend. 2. Crie uma chave de API. 3. No servidor, configure
      <code>RESEND_API_KEY</code> e <code>RESEND_FROM</code>. 4. Reinicie o servidor e crie uma regra de e-mail.</p>
      <span class="badge ${config.emailConfigured ? 'paid' : 'overdue'}">${config.emailConfigured ? 'Configurado' : 'Aguardando configuração'}</span>
      <p class="small section"><a class="text-link" href="https://resend.com/docs/api-reference/emails/send-email" target="_blank" rel="noopener noreferrer">Documentação oficial do Resend ↗</a></p>
      </section><section class="panel"><h2>WhatsApp oficial</h2>
      <p>1. Configure uma conta e número na plataforma da Meta. 2. Crie e aprove um modelo de mensagem.
      3. Solicite autorização de contato ao cliente. 4. Configure token, ID do número, versão da Graph API e webhook no servidor.
      5. Cadastre a regra com o nome do modelo aprovado e suas variáveis.</p>
      <span class="badge ${config.whatsappConfigured ? 'paid' : 'overdue'}">${config.whatsappConfigured ? 'Configurado' : 'Aguardando configuração'}</span>
      <p class="small section"><a class="text-link" href="https://www.postman.com/meta/whatsapp-business-platform/overview" target="_blank" rel="noopener noreferrer">Coleção oficial da Meta ↗</a></p>
      </section><section class="panel"><h2>Processamento</h2>
      <p>O servidor mantém a fila e agenda mensagens relativas à data do evento ou ao vencimento de parcelas.
      Alterações de data cancelam os agendamentos antigos e criam os novos.</p>
      <span class="badge ${config.workerEnabled ? 'paid' : 'overdue'}">${config.workerEnabled ? 'Worker ativo' : 'Worker desativado'}</span>
      <p class="small section">As credenciais nunca aparecem nesta tela. Veja o guia <code>docs/MENSAGENS.md</code> no repositório.</p>
      </section></div>` : ''}</div>`, '/app/mensagens'));
    const root = document.querySelector('#messages-page');
    root.addEventListener('submit', async event => {
      const form = event.target.closest('[data-message-form]'); if (!form) return;
      event.preventDefault(); event.stopPropagation();
      const button = form.querySelector('[type="submit"]'); if (button) button.disabled = true;
      try {
        if (form.dataset.messageForm === 'job-filter') {
          const selected = new FormData(form).get('status');
          go(`/app/mensagens?tab=jobs${selected ? `&status=${encodeURIComponent(selected)}` : ''}`);
          return;
        }
        const data = payload(form);
        const editing = form.dataset.messageForm === 'update-rule';
        await api(editing ? `/api/messages/rules/${encodeURIComponent(form.dataset.id)}`
          : '/api/messages/rules', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(data) });
        toast(editing ? 'Automação atualizada.' : 'Automação criada.'); await adminPage();
      } catch (error) { toast(error.message, true); }
      finally { if (button) button.disabled = false; }
    });
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-message-action]'); if (!button) return;
      event.preventDefault(); event.stopPropagation(); button.disabled = true;
      try {
        if (button.dataset.messageAction === 'retry') {
          await api(`/api/messages/jobs/${encodeURIComponent(button.dataset.id)}/retry`,
            { method: 'POST', body: '{}' });
          toast('Mensagem devolvida à fila.');
        } else if (button.dataset.messageAction === 'sync') {
          const result = await api('/api/messages/sync', { method: 'POST', body: '{}' });
          toast(`${result.created} novo(s) agendamento(s), ${result.cancelled} cancelado(s).`);
        }
        await adminPage();
      } catch (error) { toast(error.message, true); button.disabled = false; }
    });
  }
  async function portalPage() {
    const [data, preferences] = await Promise.all([
      api('/api/portal/notifications'), api('/api/portal/notification-preferences'),
    ]);
    const items = data.notifications || [];
    html(portalShell(`<div id="portal-notifications"><a class="text-link small" href="/portal"
      data-nav="/portal">← Meus eventos</a><div class="page-head section"><div>
      <div class="eyebrow">Seu espaço</div><h1>Notificações</h1>
      <p>Atualizações sobre seus eventos e suas preferências de contato.</p></div></div>
      <div class="grid two"><section><h2>Mensagens no portal</h2>
      ${items.length ? items.map(item => `<article class="panel message-portal-card ${item.readAt ? '' : 'unread'}">
        <div class="panel-head"><div><strong>${esc(item.eventName)}</strong>
          <small>${dateTime(item.sentAt)}</small></div>${item.readAt ? '' : '<span class="badge">Nova</span>'}</div>
        ${item.subject ? `<h3>${esc(item.subject)}</h3>` : ''}<p>${esc(item.body)}</p>
        <div class="page-actions"><a class="text-link small" href="/portal/eventos/${esc(item.eventId)}"
          data-nav="/portal/eventos/${esc(item.eventId)}">Abrir evento</a>
        ${item.readAt ? '' : `<button class="button secondary small" data-message-action="read"
          data-id="${esc(item.id)}">Marcar como lida</button>`}</div></article>`).join('')
        : '<div class="panel"><p>Nenhuma notificação por enquanto.</p></div>'}</section>
      <section><div class="panel"><h2>Preferências de contato</h2>
        <p>Você escolhe se deseja receber mensagens externas. As notificações neste portal continuam disponíveis.</p>
        <form data-message-form="preferences"><label class="check-option"><input name="emailOptIn"
          type="checkbox" ${preferences.emailOptIn ? 'checked' : ''}> Receber e-mails automáticos</label>
          <label class="check-option section"><input name="whatsappOptIn" type="checkbox"
          ${preferences.whatsappOptIn ? 'checked' : ''}> Receber mensagens pelo WhatsApp oficial</label>
          <label class="check-option section"><input name="consentConfirmed" type="checkbox">
          Confirmo que autorizo os canais selecionados para mensagens sobre meus eventos.</label>
          <p class="small section">Você pode retirar a autorização a qualquer momento. Para WhatsApp,
          seu telefone deve estar no formato internacional cadastrado pela equipe.</p>
          <button class="button" type="submit">Salvar preferências</button></form></div></section></div></div>`));
    const root = document.querySelector('#portal-notifications');
    root.addEventListener('submit', async event => {
      const form = event.target.closest('[data-message-form="preferences"]'); if (!form) return;
      event.preventDefault(); event.stopPropagation();
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const values = new FormData(form);
        await api('/api/portal/notification-preferences', { method: 'PATCH',
          body: JSON.stringify({ emailOptIn: values.has('emailOptIn'),
            whatsappOptIn: values.has('whatsappOptIn'), consentConfirmed: values.has('consentConfirmed') }) });
        toast('Preferências salvas.'); await portalPage();
      } catch (error) { toast(error.message, true); button.disabled = false; }
    });
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-message-action="read"]'); if (!button) return;
      event.preventDefault(); event.stopPropagation(); button.disabled = true;
      try {
        await api(`/api/portal/notifications/${encodeURIComponent(button.dataset.id)}/read`,
          { method: 'POST', body: '{}' });
        await portalPage();
      } catch (error) { toast(error.message, true); button.disabled = false; }
    });
  }
  return { adminPage, portalPage };
}
