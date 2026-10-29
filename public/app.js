const app = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const statusNames = { orcamento:'Em orçamento', negociacao:'Em negociação', contratado:'Contratado', em_execucao:'Em execução', concluido:'Concluído', cancelado:'Cancelado' };
const typeNames = { casamento:'Casamento', aniversario:'Aniversário', corporativo:'Corporativo', outro:'Outro' };
const icons = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  flower:'<path d="M12 12c-3-5-1-9 1-9 2 0 3 4 0 8 5-3 9-1 8 2-1 2-5 2-8 0 3 5 0 8-2 7-2-1-2-5 0-8-5 3-8 0-7-2 1-2 5-2 8 2Z"/><circle cx="12" cy="12" r="2"/>',
  users:'<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a4 4 0 0 1 0-8M22 20v-2a4 4 0 0 0-3-3.87"/>',
  arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
  pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>'
  ,wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h2"/>'
  ,receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M8 8h8M8 12h8"/>'
  ,download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>'
};
const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.flower}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = (n) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n || 0);
const moneyCents = (cents) => money((Number(cents)||0)/100);
const parseMoneyCents = (value) => {
  const raw=String(value||'').trim().replace(/\s|R\$/g,'');
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(raw)) throw new Error('Informe um valor em reais, como 1.250,00.');
  const [whole,fraction='']=raw.replace(/\./g,'').split(',');
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents<=0) throw new Error('O valor deve ser maior que zero.');
  return cents;
};
const dateOnlyLabel = date => date ? `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}` : 'A definir';
const todayLabel = () => new Intl.DateTimeFormat('pt-BR',{dateStyle:'full',timeZone:state.config.defaultTimezone}).format(new Date());
const dateLabel = (iso,tz='America/Sao_Paulo',opts={day:'2-digit',month:'long',year:'numeric'}) => iso ? new Intl.DateTimeFormat('pt-BR',{...opts,timeZone:tz}).format(new Date(iso)) : 'A definir';
const dateShort = (iso,tz='America/Sao_Paulo') => dateLabel(iso,tz,{day:'2-digit',month:'2-digit',year:'numeric'});
const timeLabel = (iso,tz='America/Sao_Paulo') => iso ? new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:tz}).format(new Date(iso)) : '—';
const endTimeLabel = (start,end,tz) => !end ? '' : toLocalParts(start,tz).date===toLocalParts(end,tz).date ? ` às ${timeLabel(end,tz)}` : ` até ${dateShort(end,tz)} às ${timeLabel(end,tz)}`;
const dayTile = (iso,tz='America/Sao_Paulo') => {
  if (!iso) return '<div class="date-tile"><strong>—</strong><span>data</span></div>';
  const d = new Date(iso); const day = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',timeZone:tz}).format(d);
  const month = new Intl.DateTimeFormat('pt-BR',{month:'short',timeZone:tz}).format(d).replace('.','');
  return `<div class="date-tile"><strong>${day}</strong><span>${month}</span></div>`;
};
const badge = status => `<span class="badge ${esc(status)}">${esc(statusNames[status] || status)}</span>`;
const safeLink = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const mapLink = (url,address) => safeLink(url) || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '');
const toLocalParts = (iso,tz='America/Sao_Paulo') => {
  if (!iso) return {date:'',time:''};
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
};
// Converte data e hora de parede do fuso escolhido para UTC, inclusive quando o navegador está em outro fuso.
const wallToIso = (date,time,tz) => {
  if (!date || !time) return null;
  const [y,m,d] = date.split('-').map(Number); const [hh,mm] = time.split(':').map(Number);
  let utc = Date.UTC(y,m-1,d,hh,mm);
  for (let i=0;i<3;i++) {
    const p = toLocalParts(new Date(utc).toISOString(),tz);
    const [py,pm,pd] = p.date.split('-').map(Number); const [ph,pmin] = p.time.split(':').map(Number);
    utc += Date.UTC(y,m-1,d,hh,mm) - Date.UTC(py,pm-1,pd,ph,pmin);
  }
  return new Date(utc).toISOString();
};
const initials = name => (name || 'U').trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase() || '').join('');
const state = {user:null, config:{brandName:'Jardim',contactEmail:'',contactPhone:'',defaultTimezone:'America/Sao_Paulo'}, configLoaded:false, month:new Date().toISOString().slice(0,7), eventList:[], clientList:[], teamList:[], renderId:0};
const allowed=(module,action='read') => state.user?.role==='owner' || !!state.user?.permissions?.[module]?.[action];
const defaultAdminRoute=() => allowed('dashboard')?'/app':allowed('events')?'/app/eventos':allowed('calendar')?'/app/calendario':allowed('finance')?'/app/financeiro':allowed('clients')?'/app/clientes':'/app/sem-acesso';

async function api(path, options={}) {
  const response = await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json',...(options.body ? {'Content-Type':'application/json'} : {})},...options});
  let data={}; try { data=await response.json(); } catch { /* Resposta vazia. */ }
  if (!response.ok) { const error=new Error(data.error || `Falha ao carregar dados (${response.status}).`); error.status=response.status; throw error; }
  return data;
}

function toast(message,error=false) {
  toastNode.textContent=message; toastNode.className=`visible${error?' error':''}`;
  clearTimeout(toastNode._timer); toastNode._timer=setTimeout(()=>toastNode.className='',4400);
}
function go(path) { if (location.pathname+location.search!==path) history.pushState({},'',path); render(); window.scrollTo(0,0); }
function html(node) { app.innerHTML=node; }
const navItem=(path,label,ico,active) => `<a class="nav-link ${active===path?'active':''}" href="${path}" data-nav="${path}">${icon(ico)}<span>${label}</span></a>`;
function adminShell(content,active='/app') {
  const u=state.user; const owner=u.role==='owner';
  return `<div class="app-shell"><aside class="sidebar"><a class="brand" href="/app" data-nav="/app"><span class="brand-mark">✻</span><span>${esc(state.config.brandName)}<small>Gestão de eventos</small></span></a>
    <div class="nav-label">Operação</div>${allowed('dashboard')?navItem('/app','Visão geral','home',active):''}${allowed('events')?navItem('/app/eventos','Eventos','flower',active):''}${allowed('calendar')?navItem('/app/calendario','Agenda','calendar',active):''}
    <div class="nav-label">Administração</div>${allowed('finance')?navItem('/app/financeiro','Financeiro','wallet',active):''}${allowed('clients')?navItem('/app/clientes','Clientes','users',active):''}${owner?navItem('/app/equipe','Equipe e acessos','users',active):''}
    <div class="side-bottom"><div class="side-user"><div class="avatar">${esc(initials(u.name))}</div><div><strong>${esc(u.name)}</strong><small>${owner?'Proprietário': 'Equipe'}</small></div></div><button class="side-logout" data-action="logout">Sair da conta</button></div>
  </aside><div class="main"><div class="content"><header class="topbar"><a class="mobile-brand" href="/app" data-nav="/app"><span class="brand-mark">✻</span><strong>${esc(state.config.brandName)}</strong></a><span class="today">${esc(todayLabel())}</span><span class="topbar-right"><span>${owner?'Proprietário':'Equipe'}</span><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span></span></header>${content}</div></div>
  <nav class="mobile-nav" aria-label="Navegação principal">${allowed('dashboard')?`<a href="/app" data-nav="/app" class="${active==='/app'?'active':''}">${icon('home')}<span>Início</span></a>`:''}${allowed('events')?`<a href="/app/eventos" data-nav="/app/eventos" class="${active==='/app/eventos'?'active':''}">${icon('flower')}<span>Eventos</span></a>`:''}${allowed('calendar')?`<a href="/app/calendario" data-nav="/app/calendario" class="${active==='/app/calendario'?'active':''}">${icon('calendar')}<span>Agenda</span></a>`:''}${allowed('finance')?`<a href="/app/financeiro" data-nav="/app/financeiro" class="${active==='/app/financeiro'?'active':''}">${icon('wallet')}<span>Financeiro</span></a>`:''}<details class="mobile-more"><summary class="${active==='/app/clientes'||active==='/app/equipe'?'active':''}">${icon('menu')}<span>Mais</span></summary><div class="mobile-more-panel">${allowed('clients')?`<a href="/app/clientes" data-nav="/app/clientes">${icon('users')} Clientes</a>`:''}${owner?`<a href="/app/equipe" data-nav="/app/equipe">${icon('users')} Equipe e acessos</a>`:''}<button data-action="logout">Sair da conta</button></div></details></nav></div>`;
}
function portalShell(content) {
  return `<div class="portal-shell"><header class="portal-nav"><a class="brand" href="/portal" data-nav="/portal"><span class="brand-mark">✻</span> ${esc(state.config.brandName)}</a><div class="nav-actions"><a href="/portal" data-nav="/portal">Meus eventos</a><span class="small portal-user-name">${esc(state.user.name)}</span><button data-action="logout">Sair</button></div></header><main class="portal-main">${content}</main></div>`;
}
function authShell(content) {
  return `<div class="auth-page"><div class="auth-art"><a class="brand" href="/" data-nav="/"><span class="brand-mark">✻</span> ${esc(state.config.brandName)}</a><blockquote>Os detalhes que tornam cada celebração inesquecível.</blockquote><small>Planejamento de eventos com cuidado, beleza e clareza.</small></div><main class="auth-form-side"><div class="auth-card">${content}</div></main></div>`;
}
function loginPage() {
  html(authShell(`<div class="eyebrow">Bem-vindo de volta</div><h1>Entre no seu espaço</h1><p>Acompanhe cada detalhe da sua celebração.</p><form data-form="login"><div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button class="button" type="submit">Entrar ${icon('arrow')}</button></form><p class="note">Problemas para acessar? Peça à equipe um link de recuperação.</p>`));
}
function invitePage(invitation,token) {
  const label=invitation?.eventName ? `Você foi convidado(a) para acompanhar <strong>${esc(invitation.eventName)}</strong>.` : 'Use seu convite para criar uma senha e acompanhar o evento.';
  html(authShell(`<div class="eyebrow">Seu convite</div><h1>Um lugar para acompanhar tudo</h1><p>${label}</p><form data-form="invite"><input type="hidden" name="token" value="${esc(token)}"><div class="field"><label for="name">Seu nome</label><input id="name" name="name" autocomplete="name" value="${esc(invitation?.clientName || '')}" required></div><div class="field"><label for="password">Crie uma senha</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required><span class="help">Use ao menos 12 caracteres.</span></div><button class="button" type="submit">Ativar meu acesso ${icon('arrow')}</button></form><p class="note"><a class="text-link" href="/entrar" data-nav="/entrar">Já tenho uma conta</a></p>`));
}
function resetPage(token,email) {
  html(authShell(`<div class="eyebrow">Recuperação de acesso</div><h1>Defina uma nova senha</h1><p>Conta: ${esc(email)}. Este link é de uso único e tem prazo de validade.</p><form data-form="reset"><input type="hidden" name="token" value="${esc(token)}"><div class="field"><label for="password">Nova senha</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required><span class="help">Use ao menos 12 caracteres.</span></div><button class="button" type="submit">Salvar nova senha</button></form>`));
}
function teamInvitePage(invitation,token) {
  html(authShell(`<div class="eyebrow">Convite para a equipe</div><h1>Ative seu acesso</h1><p>Olá, ${esc(invitation.name)}. Defina uma senha para acessar o painel da empresa.</p><form data-form="team-invite"><input type="hidden" name="token" value="${esc(token)}"><div class="field"><label for="password">Crie uma senha</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required><span class="help">Use ao menos 12 caracteres.</span></div><button class="button" type="submit">Ativar meu acesso</button></form>`));
}
function errPage(message,back='/app') { html(`<main class="portal-main"><div class="empty-card"><div class="empty-icon">!</div><h1>Não foi possível abrir esta página</h1><p>${esc(message)}</p><a class="button" href="${back}" data-nav="${back}">Voltar ao início</a></div></main>`); }

function eventRow(e) {
  return `<a class="list-row" href="/app/eventos/${esc(e.id)}" data-nav="/app/eventos/${esc(e.id)}">${dayTile(e.startAt,e.timezone)}<span class="row-body"><strong>${esc(e.name)}</strong><span>${esc(e.code || '')} · ${esc(e.receptionName || e.ceremonyName || e.city || 'Local a definir')}</span></span>${badge(e.status)}${icon('chevron')}</a>`;
}
async function dashboardPage() {
  const [d,f]=await Promise.all([api('/api/dashboard'),allowed('finance')?api('/api/finance/summary'):Promise.resolve(null)]); const upcoming=d.upcoming||[]; const recent=d.recent||[];
  const statusCards=[['orcamento','Em orçamento','gold'],['negociacao','Em negociação','rose'],['contratado','Contratados','green'],['em_execucao','Em execução',''],['concluido','Concluídos','green'],['cancelado','Cancelados','rose']];
  const cards=statusCards.map(([key,label,color])=>allowed('events')?`<a class="stat-card ${color}" href="/app/eventos?status=${key}" data-nav="/app/eventos?status=${key}"><span class="stat-label">${label}</span><strong>${d.byStatus?.[key]||0}</strong><span class="stat-foot">Ver eventos →</span></a>`:`<div class="stat-card ${color}"><span class="stat-label">${label}</span><strong>${d.byStatus?.[key]||0}</strong><span class="stat-foot">Resumo geral</span></div>`).join('');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Visão geral</div><h1>Olá, ${esc(state.user.name.split(' ')[0])}.</h1><p>${esc(todayLabel())}. Acompanhe as próximas decisões da empresa.</p></div>${allowed('events','write')?`<a class="button" href="/app/eventos/novo" data-nav="/app/eventos/novo">${icon('plus')} Novo evento</a>`:''}</div>
    ${f?`<section class="section dashboard-finance"><div class="section-title"><h2>Financeiro</h2><a class="text-link small" href="/app/financeiro" data-nav="/app/financeiro">Abrir financeiro →</a></div><div class="grid four"><a class="stat-card" href="/app/financeiro?direction=receivable" data-nav="/app/financeiro?direction=receivable"><span class="stat-label">A receber</span><strong class="money-stat">${moneyCents(f.summary?.receivableCents)}</strong><span class="stat-foot">Ver contas</span></a><a class="stat-card" href="/app/financeiro?direction=payable" data-nav="/app/financeiro?direction=payable"><span class="stat-label">A pagar</span><strong class="money-stat">${moneyCents(f.summary?.payableCents)}</strong><span class="stat-foot">Ver despesas</span></a><a class="stat-card" href="/app/financeiro?direction=receivable&status=overdue" data-nav="/app/financeiro?direction=receivable&status=overdue"><span class="stat-label">Recebimentos vencidos</span><strong class="money-stat">${moneyCents(f.summary?.overdueReceivableCents)}</strong><span class="stat-foot">Ver pendências</span></a><a class="stat-card" href="/app/financeiro" data-nav="/app/financeiro"><span class="stat-label">Resultado estimado</span><strong class="money-stat">${moneyCents(f.summary?.estimatedResultCents)}</strong><span class="stat-foot">Ver resumo</span></a></div></section>`:''}
    <section class="section"><div class="section-title"><h2>Eventos por etapa</h2>${allowed('events')?'<a class="text-link small" href="/app/eventos" data-nav="/app/eventos">Todos os eventos →</a>':''}</div><div class="grid six">${cards}</div></section>${f?`<section class="panel section"><div class="panel-head"><h2>Próximos vencimentos</h2><a class="text-link small" href="/app/financeiro" data-nav="/app/financeiro">Ver todos →</a></div>${f.upcoming?.length?`<div class="list">${f.upcoming.slice(0,5).map(i=>`<a class="list-row" href="${accountHref(i.accountId)}" data-nav="${accountHref(i.accountId)}"><span class="date-tile"><strong>${esc(i.dueDate.slice(8,10))}</strong><span>${esc(i.dueDate.slice(5,7))}</span></span><span class="row-body"><strong>${esc(i.accountTitle)}</strong><span>${esc(i.eventName||'Despesa geral')} · ${financeDirectionLabel(i.direction)} · ${dateOnlyLabel(i.dueDate)}</span></span><strong class="due-amount">${moneyCents(i.balanceCents)}</strong>${icon('chevron')}</a>`).join('')}</div>`:'<p>Nenhuma parcela em aberto.</p>'}</section>`:''}<div class="grid two section"><section class="panel"><div class="panel-head"><h2>Próximos eventos</h2>${allowed('calendar')?'<a class="text-link small" href="/app/calendario" data-nav="/app/calendario">Ver agenda</a>':''}</div>${upcoming.length?`<div class="list">${upcoming.slice(0,5).map(eventRow).join('')}</div>`:`<p>${allowed('events')?'Nenhum evento próximo cadastrado.':'Sua função não tem acesso aos detalhes dos eventos.'}</p>`}</section>
    <section class="panel"><div class="panel-head"><h2>Atualizados recentemente</h2>${allowed('events')?'<a class="text-link small" href="/app/eventos" data-nav="/app/eventos">Todos os eventos</a>':''}</div>${recent.length?`<div class="list">${recent.slice(0,5).map(eventRow).join('')}</div>`:`<p>${allowed('events')?'Nenhum evento cadastrado ainda.':'Sua função não tem acesso aos detalhes dos eventos.'}</p>`}</section></div>
    <div class="notice section">Reuniões, aprovações, decoração e operação serão acrescentadas nas próximas entregas.</div>`, '/app'));
}

function filteredEvents(events) {
  const params=new URLSearchParams(location.search); const q=(params.get('q')||'').toLocaleLowerCase('pt-BR'); const status=params.get('status')||''; const month=params.get('month')||''; const client=params.get('client')||''; const responsible=params.get('responsible')||'';
  return events.filter(e => (!q || [e.code,e.name,e.ceremonyName,e.receptionName,e.city,e.ceremonyAddress,e.receptionAddress,...(e.clients||[]).map(c=>c.name)].join(' ').toLocaleLowerCase('pt-BR').includes(q)) && (!status||e.status===status) && (!month||toLocalParts(e.startAt,e.timezone).date.slice(0,7)===month) && (!client||(e.clients||[]).some(c=>c.id===client)) && (!responsible||e.responsibleUserId===responsible));
}
async function eventsPage() {
  const [er,tr]=await Promise.all([api('/api/events'),state.user.role==='owner'?api('/api/team'):Promise.resolve({team:[]})]); state.eventList=er.events||[]; state.clientList=[...new Map(state.eventList.flatMap(e=>e.clients||[]).map(c=>[c.id,c])).values()]; state.teamList=tr.team?.length?tr.team:[...new Map(state.eventList.flatMap(e=>e.team||[]).map(u=>[u.id,u])).values()];
  const list=filteredEvents(state.eventList); const params=new URLSearchParams(location.search);
  const filterOptions=Object.entries(statusNames).map(([v,l])=>`<option value="${v}" ${params.get('status')===v?'selected':''}>${l}</option>`).join('');
  const clientOptions=state.clientList.map(c=>`<option value="${esc(c.id)}" ${params.get('client')===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const responsibleOptions=state.teamList.map(u=>`<option value="${esc(u.id)}" ${params.get('responsible')===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Gestão de eventos</div><h1>Eventos</h1><p>${state.eventList.length} evento${state.eventList.length===1?'':'s'} cadastrado${state.eventList.length===1?'':'s'}.</p></div>${allowed('events','write')?`<a class="button" href="/app/eventos/novo" data-nav="/app/eventos/novo">${icon('plus')} Novo evento</a>`:''}</div>
    <form class="filters" data-form="event-filters"><div class="field search"><label for="filter-q">Buscar</label><input id="filter-q" name="q" placeholder="Nome, código, local ou cliente" value="${esc(params.get('q')||'')}"></div><div class="field"><label for="filter-status">Situação</label><select id="filter-status" name="status"><option value="">Todas</option>${filterOptions}</select></div><div class="field"><label for="filter-month">Mês do evento</label><input id="filter-month" name="month" type="month" value="${esc(params.get('month')||'')}"></div><div class="field"><label for="filter-client">Cliente</label><select id="filter-client" name="client"><option value="">Todos</option>${clientOptions}</select></div><div class="field"><label for="filter-responsible">Responsável</label><select id="filter-responsible" name="responsible"><option value="">Todos</option>${responsibleOptions}</select></div><button class="button secondary" type="submit">Filtrar</button></form>
    ${list.length?`<div class="panel table-wrap"><table class="table"><thead><tr><th>Evento</th><th>Data</th><th>Local</th><th>Cliente</th><th>Situação</th><th></th></tr></thead><tbody>${list.map(e=>`<tr><td><strong>${esc(e.name)}</strong><small>${esc(e.code)} · ${esc(typeNames[e.type]||e.type)}</small></td><td>${dateShort(e.startAt,e.timezone)}<small>${timeLabel(e.startAt,e.timezone)}</small></td><td>${esc(e.receptionName||e.ceremonyName||e.city||'A definir')}</td><td>${esc((e.clients||[]).map(c=>c.name).join(', ')||'—')}</td><td>${badge(e.status)}</td><td><a class="text-link" href="/app/eventos/${esc(e.id)}" data-nav="/app/eventos/${esc(e.id)}">Abrir</a></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-card"><div class="empty-icon">✻</div><h2>${state.eventList.length?'Nenhum evento encontrado':'Seu primeiro evento começa aqui'}</h2><p>${state.eventList.length?'Altere os filtros para ver outros resultados.':'Cadastre um evento e vincule os clientes para iniciar o acompanhamento.'}</p>${state.eventList.length?'<a class="button secondary" href="/app/eventos" data-nav="/app/eventos">Limpar filtros</a>':allowed('events','write')?'<a class="button" href="/app/eventos/novo" data-nav="/app/eventos/novo">Criar evento</a>':''}</div>`}`, '/app/eventos'));
  if(window.matchMedia('(max-width:760px)').matches) {
    const filter=app.querySelector('[data-form="event-filters"]');
    const wrapper=document.createElement('details'); wrapper.className='filter-panel event-filter-panel';
    if(['q','status','month','client','responsible'].some(key=>params.get(key))) wrapper.open=true;
    wrapper.innerHTML='<summary>Buscar e filtrar eventos</summary>'; filter.replaceWith(wrapper); wrapper.append(filter);
  }
  if(list.length) {
    const panel=app.querySelector('.table-wrap'); panel.querySelector('table').classList.add('desktop-table');
    panel.insertAdjacentHTML('beforeend',`<div class="mobile-records">${list.map(e=>`<a class="account-card" href="/app/eventos/${esc(e.id)}" data-nav="/app/eventos/${esc(e.id)}"><div class="mobile-card-top">${dayTile(e.startAt,e.timezone)}<div><strong>${esc(e.name)}</strong><small>${esc(e.code||'')} · ${esc((e.clients||[]).map(c=>c.name).join(', ')||'Cliente a definir')}</small></div></div><div class="mobile-card-bottom"><span>${esc(e.receptionName||e.ceremonyName||e.city||'Local a definir')}</span>${badge(e.status)}</div></a>`).join('')}</div>`);
  }
}

async function eventFormPage(id=null) {
  const [cr,tr,er]=await Promise.all([allowed('clients')?api('/api/clients'):Promise.resolve({clients:[]}),state.user.role==='owner'?api('/api/team'):Promise.resolve({team:[]}),id?api(`/api/events/${encodeURIComponent(id)}`):Promise.resolve(null)]); state.clientList=cr.clients?.length?cr.clients:er?.event?.clients||[]; state.teamList=tr.team?.length?tr.team:[...new Map([state.user,...(er?.event?.team||[])].map(u=>[u.id,u])).values()];
  const editing=!!id; const current=er?.event; const owner=state.user.role==='owner';
  const clients=state.clientList.map(c=>`<label class="check-option"><input type="checkbox" name="clientIds" value="${esc(c.id)}"><span>${esc(c.name)} <small>· ${esc(c.email)}</small></span></label>`).join('');
  const team=state.teamList.filter(u=>u.role!=='client').map(u=>`<label class="check-option"><input type="checkbox" name="teamUserIds" value="${esc(u.id)}" ${!id&&u.id===state.user.id?'checked':''}><span>${esc(u.name)}</span></label>`).join('');
  const responsible=state.teamList.filter(u=>u.role!=='client'&&u.active!==false).map(u=>`<option value="${esc(u.id)}" ${!id&&u.id===state.user.id?'selected':''}>${esc(u.name)}</option>`).join('');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">${editing?'Atualizar cadastro':'Novo cadastro'}</div><h1>${editing?'Editar evento':'Novo evento'}</h1><p>${editing?'Revise as informações antes de salvar.':'Comece com as informações principais. Você poderá atualizá-las depois.'}</p></div><a class="button secondary" href="${editing?`/app/eventos/${esc(id)}`:'/app/eventos'}" data-nav="${editing?`/app/eventos/${esc(id)}`:'/app/eventos'}">Voltar</a></div><form class="panel" data-form="${editing?'event-update':'event-create'}" data-id="${esc(id||'')}">
    <section class="form-section"><h2>Informações do evento</h2><p>Dados usados no painel e no portal do cliente.</p><div class="form-grid"><div class="field span-2"><label for="ev-name">Nome do evento *</label><input id="ev-name" name="name" placeholder="Ex.: Casamento de Ana e Rafael" required maxlength="120"></div>
    <div class="field"><label for="ev-type">Tipo *</label><select id="ev-type" name="type"><option value="casamento">Casamento</option><option value="aniversario">Aniversário</option><option value="corporativo">Corporativo</option><option value="outro">Outro</option></select></div><div class="field"><label for="ev-status">Situação *</label><select id="ev-status" name="status">${Object.entries(statusNames).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>
    <div class="field"><label for="ev-date">Data *</label><input id="ev-date" name="date" type="date" required></div><div class="field"><label for="ev-start">Horário de início *</label><input id="ev-start" name="startTime" type="time" value="16:00" required></div><div class="field"><label for="ev-end">Horário de término</label><input id="ev-end" name="endTime" type="time" value="23:00"></div><div class="field"><label for="ev-tz">Fuso horário</label><select id="ev-tz" name="timezone"><option value="America/Sao_Paulo">São Paulo (America/Sao_Paulo)</option><option value="America/Manaus">Manaus (America/Manaus)</option><option value="America/Belem">Belém (America/Belem)</option><option value="America/Recife">Recife (America/Recife)</option><option value="America/Cuiaba">Cuiabá (America/Cuiaba)</option><option value="America/Rio_Branco">Rio Branco (America/Rio_Branco)</option><option value="UTC">UTC</option></select></div>
    <div class="field"><label for="ev-guests">Convidados estimados</label><input id="ev-guests" name="guestEstimated" type="number" min="0" step="1"></div><div class="field"><label for="ev-confirmed">Convidados confirmados</label><input id="ev-confirmed" name="guestConfirmed" type="number" min="0" step="1"></div></div></section>
    <section class="form-section"><h2>Locais</h2><p>Cadastre cerimônia e recepção separadamente quando necessário.</p><div class="form-grid"><div class="field"><label for="ev-ceremony">Local da cerimônia</label><input id="ev-ceremony" name="ceremonyName" maxlength="160"></div><div class="field"><label for="ev-reception">Local da festa</label><input id="ev-reception" name="receptionName" maxlength="160"></div><div class="field"><label for="ev-ceremony-address">Endereço da cerimônia</label><input id="ev-ceremony-address" name="ceremonyAddress" placeholder="Rua, número, bairro, cidade - UF" maxlength="300"></div><div class="field"><label for="ev-reception-address">Endereço da festa</label><input id="ev-reception-address" name="receptionAddress" placeholder="Rua, número, bairro, cidade - UF" maxlength="300"></div><div class="field"><label for="ev-city">Cidade</label><input id="ev-city" name="city" maxlength="100"></div><div class="field"><label for="ev-state">UF</label><input id="ev-state" name="state" maxlength="2" placeholder="SP"></div><div class="field"><label for="ev-postal">CEP</label><input id="ev-postal" name="postalCode" inputmode="numeric" maxlength="20" placeholder="00000-000"></div><div class="field"><label for="ev-ceremony-map">Link do mapa da cerimônia</label><input id="ev-ceremony-map" name="ceremonyMapUrl" type="url" placeholder="https://..."></div><div class="field"><label for="ev-reception-map">Link do mapa da festa</label><input id="ev-reception-map" name="receptionMapUrl" type="url" placeholder="https://..."></div></div></section>
    <section class="form-section"><h2>Pessoas envolvidas</h2><p>Clientes vinculados terão acesso somente após aceitar um convite.</p><div class="grid two"><div><h3>Clientes</h3>${clients?`<div class="check-list">${clients}</div>`:'<p>Cadastre um cliente primeiro para vinculá-lo.</p>'}${allowed('clients','write')?'<a class="text-link small" href="/app/clientes/novo" data-nav="/app/clientes/novo">Cadastrar cliente</a>':''}</div><div><h3>Responsável interno</h3>${owner?`<div class="field"><label for="ev-responsible">Pessoa responsável</label><select id="ev-responsible" name="responsibleUserId"><option value="">A definir</option>${responsible}</select></div>`:`<p>${esc(state.teamList.find(u=>u.id===current?.responsibleUserId)?.name||(!editing?state.user.name:'A definir'))}</p>`}<h3 style="margin-top:18px">Equipe</h3>${owner?(team?`<div class="check-list">${team}</div>`:'<p>Nenhum membro da equipe cadastrado.</p>'):`<p>${esc(current?.team?.map(u=>u.name).join(', ')||state.user.name)}</p>`}</div></div></section>
    <section class="form-section"><h2>Observações internas</h2><p>Este campo é visível somente para a equipe autorizada.</p><div class="field"><label for="ev-notes">Anotações</label><textarea id="ev-notes" name="internalNotes" placeholder="Informações reservadas para a operação"></textarea></div></section>
    <div class="form-actions"><a class="button secondary" href="${editing?`/app/eventos/${esc(id)}`:'/app/eventos'}" data-nav="${editing?`/app/eventos/${esc(id)}`:'/app/eventos'}">Cancelar</a><button class="button" type="submit">Salvar evento</button></div></form>`, '/app/eventos'));
  if (current) {
    const form=app.querySelector('[data-form="event-update"]'); const values={...current};
    const start=toLocalParts(current.startAt,current.timezone); const end=toLocalParts(current.endAt,current.timezone);
    values.date=start.date; values.startTime=start.time; values.endTime=end.time;
    for (const [key,value] of Object.entries(values)) {
      const control=form.elements.namedItem(key);
      if (control && typeof value !== 'object' && value != null) control.value=String(value);
    }
    for (const checkbox of form.querySelectorAll('input[name="clientIds"]')) checkbox.checked=(current.clients||[]).some(c=>c.id===checkbox.value);
    for (const checkbox of form.querySelectorAll('input[name="teamUserIds"]')) checkbox.checked=(current.team||[]).some(u=>u.id===checkbox.value);
  } else {
    app.querySelector('#ev-tz').value=state.config.defaultTimezone;
  }
}

async function eventDetailPage(id) {
  const [er,fr]=await Promise.all([api(`/api/events/${encodeURIComponent(id)}`),allowed('finance')?api(`/api/finance/events/${encodeURIComponent(id)}/summary`):Promise.resolve(null)]); const e=er.event;
  const linked=e.clients||[]; const team=e.team||[]; const responsible=team.find(u=>u.id===e.responsibleUserId);
  const ceremonyMap=mapLink(e.ceremonyMapUrl,e.ceremonyAddress); const receptionMap=mapLink(e.receptionMapUrl,e.receptionAddress);
  const locationBlock=(title,name,address,url)=>`<div class="fact"><dt>${title}</dt><dd>${esc(name||'A definir')}</dd>${address?`<div class="small">${esc(address)}</div>`:''}${url?`<a class="small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir no mapa ↗</a>`:''}</div>`;
  html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/eventos" data-nav="/app/eventos">← Todos os eventos</a></div><div class="page-actions">${allowed('events','write')?`<a class="button secondary" href="/app/eventos/${esc(e.id)}/editar" data-nav="/app/eventos/${esc(e.id)}/editar">Editar evento</a>`:''}</div></div>
    <div class="detail-hero"><div><div class="eyebrow">${esc(e.code||'Evento')}</div><h1>${esc(e.name)}</h1><p>${esc(typeNames[e.type]||e.type)} · ${dateLabel(e.startAt,e.timezone)} às ${timeLabel(e.startAt,e.timezone)}${endTimeLabel(e.startAt,e.endAt,e.timezone)}</p></div>${badge(e.status)}</div>
    <div class="grid two section"><section class="panel"><div class="panel-head"><h2>Dados do evento</h2></div><dl class="facts"><div class="fact"><dt>Data e horário</dt><dd>${dateLabel(e.startAt,e.timezone)} · ${timeLabel(e.startAt,e.timezone)}${endTimeLabel(e.startAt,e.endAt,e.timezone)}</dd><div class="small">Fuso: ${esc(e.timezone||state.config.defaultTimezone)}</div></div><div class="fact"><dt>Convidados</dt><dd>${e.guestEstimated??'—'} estimados · ${e.guestConfirmed??'—'} confirmados</dd></div><div class="fact"><dt>Responsável</dt><dd>${esc(responsible?.name||'A definir')}</dd></div>${locationBlock('Cerimônia',e.ceremonyName,e.ceremonyAddress,ceremonyMap)}${locationBlock('Festa',e.receptionName,e.receptionAddress,receptionMap)}</dl></section>
    <section class="panel"><div class="panel-head"><h2>Pessoas</h2></div><h3>Clientes vinculados</h3>${linked.length?`<div class="list">${linked.map(c=>`<div class="list-row"><span class="avatar">${esc(initials(c.name))}</span><span class="row-body"><strong>${esc(c.name)}</strong><span>${esc(c.email||'')}</span></span></div>`).join('')}</div>`:'<p>Nenhum cliente vinculado.</p>'}<h3 style="margin-top:25px">Equipe</h3>${team.length?`<p>${esc(team.map(u=>u.name).join(', '))}</p>`:'<p>Nenhum membro da equipe vinculado.</p>'}</section></div>
    ${fr?`<section class="panel section"><div class="panel-head"><h2>Financeiro do evento</h2><a class="text-link small" href="/app/financeiro?eventId=${encodeURIComponent(e.id)}" data-nav="/app/financeiro?eventId=${encodeURIComponent(e.id)}">Ver lançamentos →</a></div><div class="grid four finance-summary"><div><span>Receita prevista</span><strong>${moneyCents(fr.summary?.contractedCents)}</strong></div><div><span>Recebido</span><strong>${moneyCents(fr.summary?.receivedCents)}</strong></div><div><span>Custo previsto</span><strong>${moneyCents(fr.summary?.plannedCostCents)}</strong></div><div><span>Resultado estimado</span><strong>${moneyCents(fr.summary?.estimatedResultCents)}</strong></div></div><p class="small section">A receita prevista soma os recebimentos cadastrados manualmente; orçamento e contrato ainda não estão integrados.</p></section>`:''}
    <div class="grid two section"><section class="panel"><div class="panel-head"><h2>Convidar clientes</h2></div><p>O acesso ao portal é individual. O convite expira e só dá acesso aos eventos vinculados.</p>${allowed('events','write')?(linked.length?`<form data-form="invite-create" data-id="${esc(e.id)}"><div class="form-grid"><div class="field"><label for="invite-client">Cliente</label><select name="clientId" id="invite-client" required>${linked.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email||'')}</option>`).join('')}</select></div><div class="field"><label for="invite-days">Validade do convite</label><select name="expiresDays" id="invite-days"><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option></select></div></div><div style="margin-top:14px"><button class="button" type="submit">Gerar link de convite</button></div><div id="invite-output"></div></form>`:'<p>Vincule um cliente para gerar o convite.</p>'):'<p>Solicite ao proprietário ou à equipe autorizada um novo convite.</p>'}<div class="notice section">O link é exibido para envio manual. Nenhum e-mail ou WhatsApp é enviado automaticamente nesta etapa.</div></section>
    <section class="panel"><div class="panel-head"><h2>Informações internas</h2></div><p>${e.internalNotes?esc(e.internalNotes):'Nenhuma observação interna cadastrada.'}</p><div class="notice">Custos, margens e anotações internas nunca são incluídos na resposta da API do portal.</div></section></div>`, '/app/eventos'));
}

async function clientsPage() {
  const {clients}=await api('/api/clients'); state.clientList=clients||[];
  const q=(new URLSearchParams(location.search).get('q')||'').trim();
  const filtered=state.clientList.filter(c=>[c.name,c.email,c.phone].join(' ').toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR')));
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Relacionamento</div><h1>Clientes</h1><p>Contatos para vincular a um ou mais eventos.</p></div>${allowed('clients','write')?`<a class="button" href="/app/clientes/novo" data-nav="/app/clientes/novo">${icon('plus')} Novo cliente</a>`:''}</div>
    <form class="filters" data-form="client-filters"><div class="field search"><label for="client-q">Buscar cliente</label><input id="client-q" name="q" value="${esc(q)}" placeholder="Nome, e-mail ou telefone"></div><button class="button secondary" type="submit">Buscar</button>${q?'<a class="button ghost" href="/app/clientes" data-nav="/app/clientes">Limpar</a>':''}</form>
    ${filtered.length?`<div class="panel table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th>${allowed('clients','write')?'<th></th>':''}</tr></thead><tbody>${filtered.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email||'—')}</td><td>${esc(c.phone||'—')}</td>${allowed('clients','write')?`<td><a class="text-link" href="/app/clientes/${esc(c.id)}/editar" data-nav="/app/clientes/${esc(c.id)}/editar">Editar</a></td>`:''}</tr>`).join('')}</tbody></table></div>`:`<div class="empty-card"><div class="empty-icon">✻</div><h2>${q?'Nenhum cliente encontrado':'Ainda não há clientes'}</h2><p>${q?'Tente outra busca.':'Cadastre os contatos para vinculá-los aos eventos e enviar convites para o portal.'}</p>${q?'<a class="button secondary" href="/app/clientes" data-nav="/app/clientes">Limpar busca</a>':allowed('clients','write')?'<a class="button" href="/app/clientes/novo" data-nav="/app/clientes/novo">Cadastrar cliente</a>':''}</div>`}`, '/app/clientes'));
  if(filtered.length) {
    const panel=app.querySelector('.table-wrap'); panel.querySelector('table').classList.add('desktop-table');
    panel.insertAdjacentHTML('beforeend',`<div class="mobile-records">${filtered.map(c=>`<div class="account-card"><strong>${esc(c.name)}</strong><small>${esc(c.email||'—')}</small><small>${esc(c.phone||'—')}</small>${allowed('clients','write')?`<a class="text-link" href="/app/clientes/${esc(c.id)}/editar" data-nav="/app/clientes/${esc(c.id)}/editar">Editar cliente →</a>`:''}</div>`).join('')}</div>`);
  }
}
async function clientFormPage(id=null) {
  const editing=!!id;
  const clients=editing?(await api('/api/clients')).clients||[]:[];
  const current=editing?clients.find(c=>c.id===id):null;
  if(editing&&!current) throw new Error('Cliente não encontrado ou sem acesso.');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">${editing?'Atualizar contato':'Novo contato'}</div><h1>${editing?'Editar cliente':'Cadastrar cliente'}</h1><p>${editing?'Revise os dados antes de salvar. A alteração do e-mail cancela convites pendentes.':'O acesso ao portal será ativado por convite após o vínculo com um evento.'}</p></div><a class="button secondary" href="/app/clientes" data-nav="/app/clientes">Voltar</a></div><form class="panel" data-form="${editing?'client-update':'client-create'}" data-id="${esc(id||'')}"><div class="form-grid"><div class="field span-2"><label for="cl-name">Nome completo *</label><input id="cl-name" name="name" autocomplete="name" required maxlength="120" value="${esc(current?.name||'')}"></div><div class="field"><label for="cl-email">E-mail *</label><input id="cl-email" name="email" type="email" autocomplete="email" required maxlength="254" value="${esc(current?.email||'')}"></div><div class="field"><label for="cl-phone">Telefone</label><input id="cl-phone" name="phone" type="tel" autocomplete="tel" placeholder="(11) 99999-9999" maxlength="30" value="${esc(current?.phone||'')}"></div></div><div class="form-actions"><a class="button secondary" href="/app/clientes" data-nav="/app/clientes">Cancelar</a><button class="button" type="submit">Salvar cliente</button></div></form>`, '/app/clientes'));
}

function calendarDayEvents(events,year,month,day) {
  return events.filter(e => { const p=toLocalParts(e.startAt,e.timezone); return p.date===`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; });
}
async function calendarPage() {
  const month=state.month; const [year,m]=month.split('-').map(Number); const first=new Date(Date.UTC(year,m-1,1)); const dayOfWeek=(first.getUTCDay()+6)%7; const days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const {events}=await api(`/api/calendar?month=${month}`); const list=(events||[]).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt));
  const title=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
  const daysHtml=Array.from({length:dayOfWeek},()=>'<div class="cal-day outside" aria-hidden="true"></div>').join('')+Array.from({length:days},(_,i)=>{ const day=i+1; const dayEvents=calendarDayEvents(list,year,m,day); const today=toLocalParts(new Date().toISOString(),state.config.defaultTimezone).date===`${month}-${String(day).padStart(2,'0')}`; return `<div class="cal-day ${today?'today':''}"><span class="num">${day}</span>${dayEvents.slice(0,3).map(e=>allowed('events')?`<a class="cal-event ${esc(e.status)}" href="/app/eventos/${esc(e.id)}" data-nav="/app/eventos/${esc(e.id)}" title="${esc(e.name)}">${timeLabel(e.startAt,e.timezone)} ${esc(e.name)}</a>`:`<span class="cal-event ${esc(e.status)}" title="${esc(e.name)}">${timeLabel(e.startAt,e.timezone)} ${esc(e.name)}</span>`).join('')}${dayEvents.length>3?`<span class="small">+ ${dayEvents.length-3} outro(s)</span>`:''}</div>`; }).join('');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Agenda da empresa</div><h1>Calendário</h1><p>Eventos cadastrados no mês selecionado.</p></div><div class="calendar-controls"><button class="button secondary small" data-action="month-prev" aria-label="Mês anterior">←</button><strong>${esc(title)}</strong><button class="button secondary small" data-action="month-next" aria-label="Próximo mês">→</button></div></div>
    <div class="calendar-grid"><div class="weekday">Seg</div><div class="weekday">Ter</div><div class="weekday">Qua</div><div class="weekday">Qui</div><div class="weekday">Sex</div><div class="weekday">Sáb</div><div class="weekday">Dom</div>${daysHtml}</div>
    <section class="panel section"><div class="panel-head"><h2>Eventos de ${esc(title)}</h2><span class="small">${list.length} registro${list.length===1?'':'s'}</span></div>${list.length?`<div class="list">${list.map(e=>allowed('events')?eventRow(e):`<div class="list-row">${dayTile(e.startAt,e.timezone)}<span class="row-body"><strong>${esc(e.name)}</strong><span>${timeLabel(e.startAt,e.timezone)}</span></span>${badge(e.status)}</div>`).join('')}</div>`:'<p>Não há eventos neste mês.</p>'}</section><div class="notice section">Reuniões, visitas, tarefas e reservas entram no calendário nas próximas etapas.</div>`, '/app/calendario'));
}

async function teamPage() {
  const [tr,ur]=await Promise.all([api('/api/team'),api('/api/admin/users')]); const team=tr.team||[]; const users=ur.users||[]; state.teamList=team;
  const permLabel={events:'Eventos',clients:'Clientes',calendar:'Calendário',finance:'Financeiro'};
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Acesso interno</div><h1>Equipe e acessos</h1><p>Controle permissões por módulo, convites e recuperação de contas.</p></div></div><div class="grid two"><section class="panel"><div class="panel-head"><h2>Membros cadastrados</h2></div>${team.length?`<div class="list">${team.map(u=>`<div style="border-bottom:1px solid var(--line);padding:14px 0"><div class="list-row" style="border:0;padding:0"><span class="avatar">${esc(initials(u.name))}</span><span class="row-body"><strong>${esc(u.name)}</strong><span>${esc(u.email)} · ${u.role==='owner'?'Proprietário':esc(u.jobTitle||'Equipe')} · ${u.active?'Ativo':'Convite pendente'}</span></span></div>${u.role==='team'?`<details style="margin:12px 0 0 44px"><summary class="text-link small" style="cursor:pointer">Editar permissões</summary><form data-form="team-permissions" data-id="${esc(u.id)}" style="padding-top:12px">${Object.entries(permLabel).map(([key,label])=>`<div class="check-option" style="margin-bottom:6px"><strong style="min-width:90px">${label}</strong><label><input name="${key}Read" type="checkbox" ${u.permissions?.[key]?.read?'checked':''}> Ver</label><label><input name="${key}Write" type="checkbox" ${u.permissions?.[key]?.write?'checked':''}> Editar</label></div>`).join('')}<div class="check-option" style="margin-bottom:6px"><strong style="min-width:90px">Painel</strong><label><input name="dashboardRead" type="checkbox" ${u.permissions?.dashboard?.read?'checked':''}> Ver</label></div><button class="button secondary small" type="submit" style="margin-top:10px">Salvar permissões</button></form></details>${!u.active?`<button class="button ghost small" data-action="team-reinvite" data-id="${esc(u.id)}" style="margin:11px 0 0 44px">Gerar novo convite</button><div id="team-invite-${esc(u.id)}"></div>`:''}`:'<p class="small" style="margin:7px 0 0 44px">Acesso completo</p>'}</div>`).join('')}</div>`:'<p>Nenhum membro cadastrado.</p>'}</section>
    <section class="panel"><div class="panel-head"><h2>Convidar membro</h2></div><p>Crie o acesso e compartilhe o link manualmente. O convite expira.</p><form data-form="team-create"><div class="field"><label for="team-name">Nome</label><input id="team-name" name="name" required></div><div class="field" style="margin-top:13px"><label for="team-email">E-mail</label><input id="team-email" name="email" type="email" required></div><div class="field" style="margin-top:13px"><label for="team-role">Função</label><input id="team-role" name="jobTitle" placeholder="Ex.: Florista, produção, comercial"></div><h3 style="margin-top:20px">Permissões</h3>${Object.entries(permLabel).map(([key,label])=>`<div class="check-option" style="margin-bottom:6px"><strong style="min-width:90px">${label}</strong><label><input name="${key}Read" type="checkbox" checked> Ver</label><label><input name="${key}Write" type="checkbox"> Editar</label></div>`).join('')}<div class="check-option"><strong style="min-width:90px">Painel</strong><label><input name="dashboardRead" type="checkbox" checked> Ver</label></div><button class="button" type="submit" style="margin-top:15px">Criar convite</button><div id="team-output"></div></form></section></div>
    <section class="panel section"><div class="panel-head"><h2>Recuperação de acesso</h2></div><p>Gere um link de uso único para um usuário ativo e compartilhe-o por um canal seguro. A aplicação não envia a mensagem automaticamente.</p><form data-form="password-reset-link" class="filters" style="margin-bottom:0"><div class="field" style="flex:2"><label for="reset-user">Conta</label><select id="reset-user" name="userId" required>${users.filter(u=>u.active).map(u=>`<option value="${esc(u.id)}">${esc(u.name)} · ${esc(u.email)} (${u.role==='client'?'cliente':u.role==='owner'?'proprietário':'equipe'})</option>`).join('')}</select></div><button class="button secondary" type="submit">Gerar link</button></form><div id="reset-output"></div></section>`, '/app/equipe'));
  // Acesso financeiro é sensível e começa desabilitado para novos membros.
  const financeRead=app.querySelector('[data-form="team-create"] input[name="financeRead"]');
  if(financeRead) financeRead.checked=false;
}

function countdown(iso) {
  if (!iso) return {number:'—',label:'dias para o evento'};
  const diff=Math.ceil((new Date(iso).getTime()-Date.now())/86400000);
  if (diff<0) return {number:'✻',label:'evento realizado'};
  if (diff===0) return {number:'0',label:'é hoje!'};
  return {number:String(diff),label:diff===1?'dia para o evento':'dias para o evento'};
}
function contactBlock() {
  const email=String(state.config.contactEmail||'').trim();
  const phone=String(state.config.contactPhone||'').trim();
  const emailLink=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?`<a class="text-link" href="mailto:${esc(email)}">${esc(email)}</a>`:'';
  const phoneLink=/^\+?[\d\s().-]{8,30}$/.test(phone)?`<a class="text-link" href="tel:${esc(phone.replace(/[^\d+]/g,''))}">${esc(phone)}</a>`:'';
  if(!emailLink&&!phoneLink) return '';
  return `<section class="panel portal-section"><div class="panel-head"><h2>Fale com a equipe</h2></div><p>Para corrigir dados ou tirar dúvidas, entre em contato com ${esc(state.config.brandName)}.</p><div class="contact-links">${emailLink}${phoneLink}</div></section>`;
}
async function portalHomePage() {
  const {events}=await api('/api/portal/events'); const list=events||[];
  const next=list.filter(e=>new Date(e.startAt)>new Date()).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt))[0]||list[0];
  html(portalShell(`<div class="eyebrow">Seu espaço</div><h1>Bem-vindo(a), ${esc(state.user.name.split(' ')[0])}.</h1><p>Acompanhe as informações dos eventos compartilhados com você.</p>
    ${next?`<div class="portal-hero portal-section"><div><div class="eyebrow">Sua celebração</div><h1>${esc(next.name)}</h1><p>${dateLabel(next.startAt,next.timezone)} às ${timeLabel(next.startAt,next.timezone)} · ${esc(next.receptionName||next.ceremonyName||next.city||'Local em definição')}</p><a class="button" style="margin-top:20px;background:#fff;color:var(--deep)" href="/portal/eventos/${esc(next.id)}" data-nav="/portal/eventos/${esc(next.id)}">Ver detalhes ${icon('arrow')}</a></div><div class="countdown"><strong>${countdown(next.startAt).number}</strong><span>${countdown(next.startAt).label}</span></div></div>`:''}
    <section class="portal-section"><div class="section-title"><h2>Meus eventos</h2></div>${list.length?`<div class="grid two">${list.map(e=>`<a class="panel portal-event-card" href="/portal/eventos/${esc(e.id)}" data-nav="/portal/eventos/${esc(e.id)}"><div class="list-row" style="padding:0;border:0">${dayTile(e.startAt,e.timezone)}<span class="row-body"><h2>${esc(e.name)}</h2><p>${esc(typeNames[e.type]||e.type)} · ${esc(e.receptionName||e.ceremonyName||'Local em definição')}</p></span></div>${badge(e.status)}</a>`).join('')}</div>`:'<div class="empty-card"><div class="empty-icon">✻</div><h2>Nenhum evento disponível</h2><p>Quando a equipe vincular seu acesso a um evento, ele aparecerá aqui.</p></div>'}</section>${contactBlock()}<div class="notice portal-section">Os valores compartilhados pela equipe aparecem nos detalhes de cada evento. A criação de referências, reuniões e aprovações virá nas próximas entregas.</div>`));
}
async function portalEventPage(id) {
  const [er,fr]=await Promise.all([api(`/api/portal/events/${encodeURIComponent(id)}`),api(`/api/portal/events/${encodeURIComponent(id)}/finance`)]); const e=er.event; const cd=countdown(e.startAt);
  const ceremonyMap=mapLink(e.ceremonyMapUrl,e.ceremonyAddress); const receptionMap=mapLink(e.receptionMapUrl,e.receptionAddress);
  html(portalShell(`<a class="text-link small" href="/portal" data-nav="/portal">← Meus eventos</a><div class="portal-hero portal-section"><div><div class="eyebrow">${esc(e.code||'Sua celebração')}</div><h1>${esc(e.name)}</h1><p>${dateLabel(e.startAt,e.timezone)} · ${timeLabel(e.startAt,e.timezone)}${endTimeLabel(e.startAt,e.endAt,e.timezone)}</p></div><div class="countdown"><strong>${cd.number}</strong><span>${cd.label}</span></div></div>
    <div class="grid two portal-section"><section class="panel"><div class="panel-head"><h2>Informações do evento</h2></div><dl class="facts"><div class="fact"><dt>Tipo</dt><dd>${esc(typeNames[e.type]||e.type)}</dd></div><div class="fact"><dt>Situação</dt><dd>${badge(e.status)}</dd></div><div class="fact"><dt>Data</dt><dd>${dateLabel(e.startAt,e.timezone)}</dd></div><div class="fact"><dt>Horário</dt><dd>${timeLabel(e.startAt,e.timezone)}${endTimeLabel(e.startAt,e.endAt,e.timezone)}</dd></div></dl></section>
    <section class="panel"><div class="panel-head"><h2>Locais</h2></div><dl class="facts"><div class="fact"><dt>Cerimônia</dt><dd>${esc(e.ceremonyName||'A definir')}</dd>${e.ceremonyAddress?`<div class="small">${esc(e.ceremonyAddress)}</div>`:''}${ceremonyMap?`<a class="small" href="${esc(ceremonyMap)}" target="_blank" rel="noopener noreferrer">Abrir no mapa ↗</a>`:''}</div><div class="fact"><dt>Festa</dt><dd>${esc(e.receptionName||'A definir')}</dd>${e.receptionAddress?`<div class="small">${esc(e.receptionAddress)}</div>`:''}${receptionMap?`<a class="small" href="${esc(receptionMap)}" target="_blank" rel="noopener noreferrer">Abrir no mapa ↗</a>`:''}</div></dl></section></div>
    <section class="panel portal-section"><div class="panel-head"><h2>Financeiro compartilhado</h2></div>${fr.accounts?.length?`<div class="grid three finance-summary"><div><span>Valores informados pela equipe</span><strong>${moneyCents(fr.summary?.contractedCents)}</strong></div><div><span>Pagamentos reconhecidos</span><strong>${moneyCents(fr.summary?.receivedCents)}</strong></div><div><span>Saldo a pagar</span><strong>${moneyCents(fr.summary?.receivableCents)}</strong></div></div><h3 class="portal-section">Parcelas</h3><div class="installment-list">${fr.accounts.flatMap(a=>(a.installments||[]).map(i=>({...i,accountTitle:a.title}))).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')).map(i=>`<div class="installment-row"><div><strong>${esc(i.accountTitle)}</strong><small>Vence em ${dateOnlyLabel(i.dueDate)} · ${i.status==='paid'?'Pago':i.status==='overdue'?'Vencido':i.status==='partial'?'Pagamento parcial':'Em aberto'}</small></div><div class="align-right"><strong>${moneyCents(i.amountCents)}</strong><small>Saldo ${moneyCents(i.balanceCents)}</small></div></div>`).join('')}</div>${fr.accounts.some(a=>a.payments?.length)?`<h3 class="portal-section">Pagamentos reconhecidos</h3><div class="installment-list">${fr.accounts.flatMap(a=>(a.payments||[]).map(p=>({...p,accountTitle:a.title}))).sort((a,b)=>(b.paidOn||'').localeCompare(a.paidOn||'')).map(p=>`<div class="installment-row"><div><strong>${esc(p.accountTitle)}</strong><small>${dateOnlyLabel(p.paidOn)} · ${esc(p.paymentMethod||'Forma não informada')}</small></div><strong>${moneyCents(p.amountCents)}</strong></div>`).join('')}</div>`:''}`:'<p>A equipe ainda não compartilhou valores financeiros deste evento.</p>'}<p class="small portal-section">Pagamentos são registrados pela equipe. Este portal não realiza cobrança ou assinatura de contrato.</p></section>
    ${contactBlock()}<div class="notice portal-section">Solicitações e aprovações pelo portal serão acrescentadas nas próximas entregas.</div>`));
}

const financeStatusLabels={open:'Em aberto',partial:'Parcial',paid:'Quitado',overdue:'Vencido',cancelled:'Cancelado'};
const financeDirectionLabel=direction=>direction==='payable'?'A pagar':'A receber';
const financeStatusBadge=status=>`<span class="badge finance-${esc(status)}">${esc(financeStatusLabels[status]||status||'Em aberto')}</span>`;
const financeDate=account=>(account.installments||[]).find(i=>Number(i.balanceCents)>0)?.dueDate||account.installments?.[0]?.dueDate||'';
const accountHref=id=>`/app/financeiro/contas/${encodeURIComponent(id)}`;
function financeAccountCard(account) {
  const href=accountHref(account.id);
  return `<a class="finance-account" href="${href}" data-nav="${href}"><span class="finance-account-main"><strong>${esc(account.title)}</strong><small>${esc(account.eventName||account.supplierName||'Despesa geral da empresa')} · ${dateOnlyLabel(financeDate(account))}</small></span><span class="finance-account-values"><strong>${moneyCents(account.balanceCents)}</strong><small>de ${moneyCents(account.amountCents)}</small></span>${financeStatusBadge(account.status)}${icon('chevron')}</a>`;
}
async function financePage() {
  if(!allowed('finance')) throw new Error('Você não tem acesso ao financeiro.');
  const p=new URLSearchParams(location.search); const direction=p.get('direction')||''; const status=p.get('status')||''; const eventId=p.get('eventId')||''; const q=p.get('q')||''; const from=p.get('from')||''; const to=p.get('to')||'';
  const aq=new URLSearchParams(); if(direction) aq.set('direction',direction); if(status) aq.set('status',status); if(eventId) aq.set('eventId',eventId); if(q) aq.set('q',q); if(from) aq.set('from',from); if(to) aq.set('to',to);
  const sq=new URLSearchParams(); if(from) sq.set('from',from); if(to) sq.set('to',to); if(eventId) sq.set('eventId',eventId);
  const [sr,ar,er]=await Promise.all([api(`/api/finance/summary${sq.size?'?'+sq:''}`),api(`/api/finance/accounts${aq.size?'?'+aq:''}`),api('/api/finance/events')]);
  const s=sr.summary||{}; const accounts=ar.accounts||[]; const events=er.events||[];
  const eventOptions=events.map(e=>`<option value="${esc(e.id)}" ${eventId===e.id?'selected':''}>${esc(e.name)}</option>`).join('');
  const queryFor=(newDirection)=>{const next=new URLSearchParams(location.search); if(newDirection) next.set('direction',newDirection); else next.delete('direction'); return `/app/financeiro${next.size?'?'+next:''}`;};
  const csv=`/api/finance/export.csv${aq.size?'?'+aq:''}`;
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Administração</div><h1>Financeiro</h1><p>Entradas, despesas e resultado em um só lugar.</p></div><div class="page-actions">${allowed('finance','write')?`<a class="button secondary" href="/app/financeiro/novo?direction=payable" data-nav="/app/financeiro/novo?direction=payable">Nova despesa</a><a class="button" href="/app/financeiro/novo?direction=receivable" data-nav="/app/financeiro/novo?direction=receivable">${icon('plus')} Novo recebimento</a>`:''}</div></div>
    <div class="section-title"><h2>${eventId?'Resumo do evento':'Resumo consolidado'}</h2><span class="small">${from||to?'Parcelas com vencimento no período':'Todos os vencimentos'}</span></div><section class="grid four finance-kpis"><div class="stat-card"><span class="stat-label">Receita prevista</span><strong class="money-stat">${moneyCents(s.contractedCents)}</strong><span class="stat-foot">Contas a receber lançadas</span></div><div class="stat-card"><span class="stat-label">Recebimentos ${from||to?'no período':''}</span><strong class="money-stat">${moneyCents(sr.cashFlow?.receivedCents??s.receivedCents)}</strong><span class="stat-foot">Caixa realizado por data do pagamento</span></div><div class="stat-card"><span class="stat-label">Saldo a receber</span><strong class="money-stat">${moneyCents(s.receivableCents)}</strong><span class="stat-foot">Vencido: ${moneyCents(s.overdueReceivableCents)}</span></div><div class="stat-card"><span class="stat-label">Resultado estimado</span><strong class="money-stat">${moneyCents(s.estimatedResultCents)}</strong><span class="stat-foot">Receita prevista − custo previsto</span></div></section>
    <section class="grid three section finance-summary"><div><span>Custo previsto</span><strong>${moneyCents(s.plannedCostCents)}</strong></div><div><span>Pagamentos realizados ${from||to?'no período':''}</span><strong>${moneyCents(sr.cashFlow?.paidCents??s.paidCostCents)}</strong></div><div><span>A pagar</span><strong>${moneyCents(s.payableCents)}</strong><small>Vencido: ${moneyCents(s.overduePayableCents)}</small></div></section>
    <section class="section"><div class="section-title"><div><h2>Lançamentos</h2><p class="small">${accounts.length} registro${accounts.length===1?'':'s'} encontrado${accounts.length===1?'':'s'}</p></div><a class="button secondary small" href="${esc(csv)}" download>${icon('download')} Exportar CSV</a></div><nav class="finance-tabs" aria-label="Tipo de lançamento"><a class="${!direction?'active':''}" href="${queryFor('')}" data-nav="${queryFor('')}">Todos</a><a class="${direction==='receivable'?'active':''}" href="${queryFor('receivable')}" data-nav="${queryFor('receivable')}">A receber</a><a class="${direction==='payable'?'active':''}" href="${queryFor('payable')}" data-nav="${queryFor('payable')}">A pagar</a></nav>
    <details class="filter-panel" ${q||status||eventId||from||to?'open':''}><summary>Buscar e filtrar lançamentos</summary><form class="filters" data-form="finance-filters"><input type="hidden" name="direction" value="${esc(direction)}"><div class="field search"><label for="fin-q">Buscar</label><input id="fin-q" name="q" value="${esc(q)}" placeholder="Título, evento ou fornecedor"></div><div class="field"><label for="fin-status">Situação</label><select id="fin-status" name="status"><option value="">Todas</option>${Object.entries(financeStatusLabels).filter(([key])=>key!=='cancelled').map(([key,label])=>`<option value="${key}" ${status===key?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="fin-event">Evento</label><select id="fin-event" name="eventId"><option value="">Todos</option>${eventOptions}</select></div><div class="field"><label for="fin-from">Vencimento de</label><input id="fin-from" name="from" type="date" value="${esc(from)}"></div><div class="field"><label for="fin-to">Até</label><input id="fin-to" name="to" type="date" value="${esc(to)}"></div><button class="button secondary" type="submit">Aplicar</button></form><p class="small">Período e evento alteram o resumo. Tipo, situação e busca filtram a lista. Os valores da lista mostram o total de cada lançamento encontrado.</p></details>
    ${accounts.length?`<div class="panel finance-list"><div class="desktop-table table-wrap"><table class="table"><thead><tr><th>Lançamento</th><th>Vencimento</th><th>Valor total</th><th>Pago</th><th>Saldo</th><th>Situação</th><th></th></tr></thead><tbody>${accounts.map(a=>`<tr><td><strong>${esc(a.title)}</strong><small>${esc(a.eventName||a.supplierName||'Despesa geral')} · ${financeDirectionLabel(a.direction)}</small></td><td>${dateOnlyLabel(financeDate(a))}</td><td>${moneyCents(a.amountCents)}</td><td>${moneyCents(a.paidCents)}</td><td><strong>${moneyCents(a.balanceCents)}</strong></td><td>${financeStatusBadge(a.status)}</td><td><a class="text-link" href="${accountHref(a.id)}" data-nav="${accountHref(a.id)}">Abrir</a></td></tr>`).join('')}</tbody></table></div><div class="mobile-records">${accounts.map(financeAccountCard).join('')}</div></div>`:`<div class="empty-card"><div class="empty-icon">${icon('receipt')}</div><h2>Nenhum lançamento encontrado</h2><p>${aq.size?'Altere os filtros para consultar outros registros.':'Cadastre um recebimento ou uma despesa para começar o controle financeiro.'}</p>${allowed('finance','write')?'<a class="button" href="/app/financeiro/novo" data-nav="/app/financeiro/novo">Criar lançamento</a>':''}</div>`}</section>`, '/app/financeiro'));
}

const addMonthsClamped=(date,offset)=>{const [y,m,d]=date.split('-').map(Number); const first=new Date(Date.UTC(y,m-1+offset,1)); const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(); return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;};
const centsInput=cents=>(Number(cents)/100).toFixed(2).replace('.',',');
function renderInstallmentInputs(form) {
  const target=form.querySelector('#finance-installments'); if(!target) return;
  const count=Number(form.elements.namedItem('installmentCount')?.value||1); const amount=form.elements.namedItem('amount')?.value||''; const due=form.elements.namedItem('dueDate')?.value||'';
  if(count<=1) {target.innerHTML=''; return;}
  if(!amount||!due) {target.innerHTML='<p class="small">Preencha o valor total e o primeiro vencimento para distribuir as parcelas.</p>'; return;}
  try {const cents=parseMoneyCents(amount); const base=Math.floor(cents/count); const remainder=cents-base*count; target.innerHTML=`<h3>Parcelas</h3><p class="small">Ajuste valores e datas conforme a negociação. A soma deve ser igual ao valor total.</p><div class="installment-editor">${Array.from({length:count},(_,i)=>`<div class="installment-edit"><strong>${i+1}ª parcela</strong><div class="field"><label>Valor (R$)</label><input name="installmentAmount" inputmode="decimal" required value="${centsInput(base+(i===count-1?remainder:0))}"></div><div class="field"><label>Vencimento</label><input name="installmentDueDate" type="date" required value="${addMonthsClamped(due,i)}"></div></div>`).join('')}</div>`;} catch(error) {target.innerHTML=`<p class="notice error">${esc(error.message)}</p>`;}
}
async function updateFinanceClients(form) {
  const field=form.querySelector('#finance-client-field'); if(!field) return;
  const eventId=form.elements.namedItem('eventId').value;
  if(!eventId||form.elements.namedItem('direction').value!=='receivable') {field.style.display='none'; field.innerHTML=''; return;}
  const {clients}=await api(`/api/finance/events/${encodeURIComponent(eventId)}/clients`);
  if(!field.isConnected||form.elements.namedItem('eventId').value!==eventId) return;
  field.style.display='flex'; field.innerHTML=`<label for="fc-client">Cobrança individual</label><select id="fc-client" name="clientId"><option value="">Todos os clientes vinculados</option>${(clients||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email||'')}</option>`).join('')}</select><small>Se escolher uma pessoa, apenas ela verá este lançamento compartilhado.</small>`;
}
async function financeNewPage() {
  if(!allowed('finance','write')) throw new Error('Você não pode criar lançamentos financeiros.');
  const p=new URLSearchParams(location.search); const direction=p.get('direction')==='payable'?'payable':'receivable'; const eventId=p.get('eventId')||'';
  const events=(await api('/api/finance/events')).events||[]; if(state.user.role==='team'&&!events.length) throw new Error('Vincule esta conta a um evento antes de criar lançamentos.');
  html(adminShell(`<div class="page-head"><div><div class="eyebrow">Financeiro</div><h1>Novo lançamento</h1><p>Registre o valor combinado, os vencimentos e os pagamentos realizados.</p></div><a class="button secondary" href="/app/financeiro" data-nav="/app/financeiro">Voltar</a></div><form class="panel finance-form" data-form="finance-create"><div class="form-grid"><div class="field"><label for="fc-direction">Tipo *</label><select id="fc-direction" name="direction"><option value="receivable" ${direction==='receivable'?'selected':''}>A receber</option><option value="payable" ${direction==='payable'?'selected':''}>A pagar</option></select></div><div class="field"><label for="fc-event">Evento</label><select id="fc-event" name="eventId">${state.user.role==='owner'?'<option value="">Sem evento (lançamento geral)</option>':''}${events.map(e=>`<option value="${esc(e.id)}" ${eventId===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div><div class="field span-2"><label for="fc-title">Descrição *</label><input id="fc-title" name="title" required maxlength="160" placeholder="Ex.: Decoração floral do casamento"></div><div class="field"><label for="fc-category">Categoria</label><select id="fc-category" name="category"><option value="">Selecione</option>${['Flores','Decoração','Mobiliário','Estrutura','Equipe','Transporte','Serviços','Outros'].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div><div class="field"><label for="fc-supplier">Fornecedor ou referência interna</label><input id="fc-supplier" name="supplierName" maxlength="160" placeholder="Opcional"></div><div class="field"><label for="fc-amount">Valor total (R$) *</label><input id="fc-amount" name="amount" inputmode="decimal" placeholder="0,00" required></div><div class="field"><label for="fc-due">Primeiro vencimento *</label><input id="fc-due" name="dueDate" type="date" required></div><div class="field"><label for="fc-count">Quantidade de parcelas</label><select id="fc-count" name="installmentCount">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} ${i===0?'parcela':'parcelas'}</option>`).join('')}</select></div><div class="field span-2"><label class="check-option"><input type="checkbox" name="sharedWithClient" ${direction==='receivable'&&eventId?'checked':''}> Compartilhar este recebimento e suas parcelas no portal dos clientes vinculados</label><small>Custos e notas internas nunca aparecem no portal.</small></div><div class="field span-2"><label for="fc-notes">Observações internas</label><textarea id="fc-notes" name="notes" maxlength="2000"></textarea></div></div><div id="finance-installments" class="form-section"></div><div class="form-actions"><a class="button secondary" href="/app/financeiro" data-nav="/app/financeiro">Cancelar</a><button class="button" type="submit">Salvar lançamento</button></div></form>`, '/app/financeiro'));
  const form=app.querySelector('[data-form="finance-create"]');
  form.elements.namedItem('eventId').closest('.field').insertAdjacentHTML('afterend','<div id="finance-client-field" class="field" style="display:none"></div>');
  await updateFinanceClients(form);
}

async function financeAccountPage(id) {
  if(!allowed('finance')) throw new Error('Você não tem acesso ao financeiro.');
  const {account:a}=await api(`/api/finance/accounts/${encodeURIComponent(id)}`); const canWrite=allowed('finance','write');
  html(adminShell(`<div class="page-head"><div><a class="text-link small" href="/app/financeiro" data-nav="/app/financeiro">← Financeiro</a><div class="eyebrow section">${financeDirectionLabel(a.direction)}</div><h1>${esc(a.title)}</h1><p>${esc(a.eventName||a.supplierName||'Despesa geral da empresa')}</p></div>${financeStatusBadge(a.status)}</div><section class="grid four finance-summary"><div><span>Valor total</span><strong>${moneyCents(a.amountCents)}</strong></div><div><span>${a.direction==='payable'?'Pago':'Recebido'}</span><strong>${moneyCents(a.paidCents)}</strong></div><div><span>Saldo</span><strong>${moneyCents(a.balanceCents)}</strong></div><div><span>Parcelas</span><strong>${a.installments?.length||0}</strong></div></section>
    <div class="grid two section account-detail"><section class="panel"><div class="panel-head"><h2>Parcelas</h2></div><div class="installment-list">${(a.installments||[]).map((i,index)=>`<div class="installment-row"><div><strong>${index+1}ª parcela</strong><small>Vence em ${dateOnlyLabel(i.dueDate)} · ${financeStatusLabels[i.status]||'Em aberto'}</small></div><div class="align-right"><strong>${moneyCents(i.amountCents)}</strong><small>Saldo ${moneyCents(i.balanceCents)}</small></div></div>`).join('')}</div>${a.sharedWithClient&&a.direction==='receivable'?'<p class="notice success section">Este lançamento está visível para os clientes vinculados ao evento.</p>':''}</section>
    <section class="panel"><div class="panel-head"><h2>${a.direction==='payable'?'Pagamentos':'Recebimentos'}</h2></div>${a.payments?.filter(p=>!p.voidedAt).length?`<div class="installment-list">${a.payments.filter(p=>!p.voidedAt).map(p=>`<div class="installment-row payment-row"><div><strong>${moneyCents(p.amountCents)}</strong><small>${dateOnlyLabel(p.paidOn)} · ${esc(p.paymentMethod||'Não informado')}${p.reference?` · ${esc(p.reference)}`:''}</small>${canWrite?`<details class="void-control"><summary>Estornar registro</summary><form data-form="finance-void" data-id="${esc(p.id)}"><div class="field"><label>Motivo do estorno</label><input name="reason" required maxlength="300"></div><button class="button danger small" type="submit">Confirmar estorno</button></form></details>`:''}</div></div>`).join('')}</div>`:'<p>Nenhum pagamento registrado.</p>'}${canWrite&&a.balanceCents>0?`<form class="payment-form form-section" data-form="finance-payment" data-id="${esc(a.id)}"><h3>Registrar ${a.direction==='payable'?'pagamento':'recebimento'}</h3><div class="form-grid"><div class="field"><label for="fp-amount">Valor (R$) *</label><input id="fp-amount" name="amount" inputmode="decimal" value="${centsInput(a.balanceCents)}" required></div><div class="field"><label for="fp-date">Data *</label><input id="fp-date" name="paidOn" type="date" value="${toLocalParts(new Date().toISOString(),state.config.defaultTimezone).date}" required></div><div class="field"><label for="fp-method">Forma de pagamento *</label><select id="fp-method" name="paymentMethod" required><option value="">Selecione</option><option value="Pix">Pix</option><option value="Transferência">Transferência</option><option value="Dinheiro">Dinheiro</option><option value="Cartão">Cartão</option><option value="Boleto">Boleto</option><option value="Outro">Outro</option></select></div><div class="field"><label for="fp-reference">Referência</label><input id="fp-reference" name="reference" placeholder="Identificador ou comprovante externo"></div></div><div class="form-actions"><button class="button" type="submit">Registrar valor</button></div></form>`:''}</section></div>
    ${canWrite?`<section class="panel section"><div class="panel-head"><h2>Revisar vencimentos e valores</h2></div><p class="small">As mudanças ficam registradas no histórico. Uma parcela não pode ficar abaixo do valor já pago.</p><div class="installment-list">${(a.installments||[]).map((i,index)=>`<details class="edit-installment"><summary>${index+1}ª parcela · ${dateOnlyLabel(i.dueDate)} · ${moneyCents(i.amountCents)}</summary><form class="form-grid section" data-form="finance-installment-update" data-id="${esc(a.id)}" data-installment-id="${esc(i.id)}"><div class="field"><label>Valor (R$)</label><input name="amount" inputmode="decimal" value="${centsInput(i.amountCents)}" required></div><div class="field"><label>Vencimento</label><input name="dueDate" type="date" value="${esc(i.dueDate)}" required></div><button class="button secondary" type="submit">Salvar parcela</button></form></details>`).join('')}</div><details class="edit-installment section"><summary>Adicionar parcela negociada</summary><form class="form-grid section" data-form="finance-installment-add" data-id="${esc(a.id)}"><div class="field"><label>Valor (R$)</label><input name="amount" inputmode="decimal" placeholder="0,00" required></div><div class="field"><label>Vencimento</label><input name="dueDate" type="date" required></div><button class="button" type="submit">Adicionar parcela</button></form></details></section>
    <section class="panel section"><details class="edit-account"><summary>Editar informações do lançamento</summary><form data-form="finance-update" data-id="${esc(a.id)}" class="form-grid section"><div class="field span-2"><label for="fa-title">Descrição *</label><input id="fa-title" name="title" value="${esc(a.title)}" required></div><div class="field"><label for="fa-category">Categoria</label><input id="fa-category" name="category" value="${esc(a.category||'')}"></div><div class="field"><label for="fa-supplier">Fornecedor / referência</label><input id="fa-supplier" name="supplierName" value="${esc(a.supplierName||'')}"></div><div class="field span-2"><label class="check-option"><input name="sharedWithClient" type="checkbox" ${a.sharedWithClient?'checked':''}> Compartilhar com clientes vinculados</label></div><div class="field span-2"><label for="fa-notes">Observações internas</label><textarea id="fa-notes" name="notes">${esc(a.notes||'')}</textarea></div><button class="button" type="submit">Salvar alterações</button></form></details></section>`:''}`, '/app/financeiro'));
  if(a.direction==='payable') app.querySelector('.edit-account input[name="sharedWithClient"]')?.closest('.field')?.remove();
}

function formData(form) { return new FormData(form); }
function eventPayload(form) {
  const f=formData(form); const tz=f.get('timezone')||state.config.defaultTimezone; const date=f.get('date');
  let endDate=date;
  if (f.get('endTime') && f.get('endTime')<f.get('startTime')) {
    const next=new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate()+1); endDate=next.toISOString().slice(0,10);
  }
  const teamUserIds=f.getAll('teamUserIds'); const responsibleUserId=f.get('responsibleUserId')||null;
  if (responsibleUserId && !teamUserIds.includes(responsibleUserId)) teamUserIds.push(responsibleUserId);
  return {
    name:String(f.get('name')||'').trim(),type:f.get('type'),status:f.get('status'),timezone:tz,
    startAt:wallToIso(date,f.get('startTime'),tz),endAt:f.get('endTime')?wallToIso(endDate,f.get('endTime'),tz):null,
    guestEstimated:f.get('guestEstimated')===''?null:Number(f.get('guestEstimated')),
    guestConfirmed:f.get('guestConfirmed')===''?null:Number(f.get('guestConfirmed')),
    ceremonyName:String(f.get('ceremonyName')||'').trim(),receptionName:String(f.get('receptionName')||'').trim(),
    ceremonyAddress:String(f.get('ceremonyAddress')||'').trim(),receptionAddress:String(f.get('receptionAddress')||'').trim(),
    ceremonyMapUrl:String(f.get('ceremonyMapUrl')||'').trim(),receptionMapUrl:String(f.get('receptionMapUrl')||'').trim(),
    city:String(f.get('city')||'').trim(),state:String(f.get('state')||'').trim().toUpperCase(),postalCode:String(f.get('postalCode')||'').trim(),internalNotes:String(f.get('internalNotes')||'').trim(),
    clientIds:f.getAll('clientIds'),...(state.user.role==='owner'?{teamUserIds,responsibleUserId}:{})
  };
}

async function handleForm(form) {
  const kind=form.dataset.form; const data=formData(form); const button=form.querySelector('[type="submit"]');
  if (button) button.disabled=true;
  try {
    if (kind==='login') {
      const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:String(data.get('email')||'').trim(),password:data.get('password')})});
      state.user=result.user; toast('Acesso realizado com sucesso.'); go(state.user.role==='client'?'/portal':defaultAdminRoute());
    } else if (kind==='invite') {
      const result=await api('/api/invitations/accept',{method:'POST',body:JSON.stringify({token:data.get('token'),name:String(data.get('name')||'').trim(),password:data.get('password')})});
      state.user=result.user; toast('Seu acesso foi ativado.'); go(result.eventId?`/portal/eventos/${result.eventId}`:'/portal');
    } else if (kind==='team-invite') {
      const result=await api('/api/team/invitations/accept',{method:'POST',body:JSON.stringify({token:data.get('token'),password:data.get('password')})});
      state.user=result.user; toast('Seu acesso foi ativado.'); go(defaultAdminRoute());
    } else if (kind==='reset') {
      await api('/api/auth/reset',{method:'POST',body:JSON.stringify({token:data.get('token'),password:data.get('password')})}); toast('Senha alterada. Entre com a nova senha.'); go('/entrar');
    } else if (kind==='client-create' || kind==='client-update') {
      const editing=kind==='client-update';
      await api(editing?`/api/clients/${encodeURIComponent(form.dataset.id)}`:'/api/clients',{method:editing?'PATCH':'POST',body:JSON.stringify({name:String(data.get('name')||'').trim(),email:String(data.get('email')||'').trim(),phone:String(data.get('phone')||'').trim()})}); toast(editing?'Cliente atualizado.':'Cliente cadastrado.'); go('/app/clientes');
    } else if (kind==='client-filters') {
      const q=String(data.get('q')||'').trim(); go(`/app/clientes${q?'?q='+encodeURIComponent(q):''}`);
    } else if (kind==='event-create' || kind==='event-update') {
      const editing=kind==='event-update'; const id=form.dataset.id;
      const result=await api(editing?`/api/events/${encodeURIComponent(id)}`:'/api/events',{method:editing?'PATCH':'POST',body:JSON.stringify(eventPayload(form))});
      toast(editing?'Evento atualizado.':'Evento criado.'); go(`/app/eventos/${result.event.id}`);
    } else if (kind==='event-filters') {
      const params=new URLSearchParams(); for(const key of ['q','status','month','client','responsible']) if (String(data.get(key)||'').trim()) params.set(key,String(data.get(key)).trim());
      go(`/app/eventos${params.size?'?'+params:''}`);
    } else if (kind==='finance-filters') {
      const params=new URLSearchParams(); for(const key of ['direction','q','status','eventId','from','to']) if (String(data.get(key)||'').trim()) params.set(key,String(data.get(key)).trim());
      if(params.has('from')&&params.has('to')&&params.get('from')>params.get('to')) throw new Error('A data inicial deve ser anterior à data final.');
      go(`/app/financeiro${params.size?'?'+params:''}`);
    } else if (kind==='finance-create') {
      const amountCents=parseMoneyCents(data.get('amount')); const direction=data.get('direction'); const count=Number(data.get('installmentCount')||1);
      let installments;
      if(count>1) {
        const amounts=data.getAll('installmentAmount'); const dates=data.getAll('installmentDueDate');
        if(amounts.length!==count||dates.length!==count) {renderInstallmentInputs(form); throw new Error('Revise as parcelas antes de salvar.');}
        installments=amounts.map((value,index)=>({amountCents:parseMoneyCents(value),dueDate:dates[index]}));
        if(installments.reduce((sum,item)=>sum+item.amountCents,0)!==amountCents) throw new Error('A soma das parcelas deve ser igual ao valor total.');
      }
      const payload={direction,title:String(data.get('title')||'').trim(),eventId:data.get('eventId')||null,clientId:data.get('clientId')||null,category:String(data.get('category')||'').trim(),supplierName:String(data.get('supplierName')||'').trim(),amountCents,dueDate:data.get('dueDate'),sharedWithClient:direction==='receivable'&&!!data.get('eventId')&&data.has('sharedWithClient'),notes:String(data.get('notes')||'').trim(),...(installments?{installments}:{})};
      const result=await api('/api/finance/accounts',{method:'POST',body:JSON.stringify(payload)}); toast('Lançamento criado.'); go(accountHref(result.account.id));
    } else if (kind==='finance-payment') {
      const amountCents=parseMoneyCents(data.get('amount'));
      form.dataset.requestId ||= crypto.randomUUID();
      await api(`/api/finance/accounts/${encodeURIComponent(form.dataset.id)}/payments`,{method:'POST',body:JSON.stringify({amountCents,paidOn:data.get('paidOn'),paymentMethod:data.get('paymentMethod'),reference:String(data.get('reference')||'').trim(),requestId:form.dataset.requestId})});
      toast('Valor registrado.'); go(accountHref(form.dataset.id));
    } else if (kind==='finance-installment-add') {
      await api(`/api/finance/accounts/${encodeURIComponent(form.dataset.id)}/installments`,{method:'POST',body:JSON.stringify({amountCents:parseMoneyCents(data.get('amount')),dueDate:data.get('dueDate')})});
      toast('Parcela adicionada.'); render();
    } else if (kind==='finance-installment-update') {
      await api(`/api/finance/accounts/${encodeURIComponent(form.dataset.id)}/installments/${encodeURIComponent(form.dataset.installmentId)}`,{method:'PATCH',body:JSON.stringify({amountCents:parseMoneyCents(data.get('amount')),dueDate:data.get('dueDate')})});
      toast('Parcela atualizada.'); render();
    } else if (kind==='finance-void') {
      await api(`/api/finance/payments/${encodeURIComponent(form.dataset.id)}/void`,{method:'POST',body:JSON.stringify({reason:String(data.get('reason')||'').trim()})});
      toast('Registro estornado.'); render();
    } else if (kind==='finance-update') {
      const payload={title:String(data.get('title')||'').trim(),category:String(data.get('category')||'').trim(),supplierName:String(data.get('supplierName')||'').trim(),notes:String(data.get('notes')||'').trim(),sharedWithClient:data.has('sharedWithClient')};
      await api(`/api/finance/accounts/${encodeURIComponent(form.dataset.id)}`,{method:'PATCH',body:JSON.stringify(payload)});
      toast('Lançamento atualizado.'); render();
    } else if (kind==='invite-create') {
      const result=await api(`/api/events/${encodeURIComponent(form.dataset.id)}/invitations`,{method:'POST',body:JSON.stringify({clientId:data.get('clientId'),expiresDays:Number(data.get('expiresDays'))})});
      const url=new URL(result.inviteUrl,location.origin).href; const out=form.querySelector('#invite-output'); out.innerHTML=`<div class="invite-result"><input aria-label="Link do convite" readonly value="${esc(url)}"><button type="button" class="button secondary small" data-action="copy-link" data-url="${esc(url)}">Copiar</button></div><p class="small">Válido até ${dateLabel(result.expiresAt)}. Compartilhe este link manualmente com o cliente.</p>`;
      toast('Link de convite gerado.');
    } else if (kind==='team-create') {
      const perms={}; for(const module of ['events','clients','calendar','finance']) perms[module]={read:data.has(`${module}Read`),write:data.has(`${module}Write`)}; perms.dashboard={read:data.has('dashboardRead'),write:false};
      const result=await api('/api/team',{method:'POST',body:JSON.stringify({name:String(data.get('name')||'').trim(),email:String(data.get('email')||'').trim(),jobTitle:String(data.get('jobTitle')||'').trim(),permissions:perms})});
      const url=new URL(result.inviteUrl,location.origin).href; form.querySelector('#team-output').innerHTML=`<div class="invite-result"><input aria-label="Link do convite da equipe" readonly value="${esc(url)}"><button type="button" class="button secondary small" data-action="copy-link" data-url="${esc(url)}">Copiar</button></div><p class="small">Envie o link manualmente ao membro da equipe.</p>`;
      toast('Convite da equipe criado.');
    } else if (kind==='team-permissions') {
      const perms={}; for(const module of ['events','clients','calendar','finance']) perms[module]={read:data.has(`${module}Read`),write:data.has(`${module}Write`)}; perms.dashboard={read:data.has('dashboardRead'),write:false};
      await api(`/api/team/${encodeURIComponent(form.dataset.id)}/permissions`,{method:'PATCH',body:JSON.stringify({permissions:perms})});
      toast('Permissões atualizadas.');
    } else if (kind==='password-reset-link') {
      const result=await api(`/api/admin/users/${encodeURIComponent(data.get('userId'))}/reset-link`,{method:'POST',body:'{}'});
      const url=new URL(result.resetUrl,location.origin).href; form.parentElement.querySelector('#reset-output').innerHTML=`<div class="invite-result"><input aria-label="Link de recuperação" readonly value="${esc(url)}"><button type="button" class="button secondary small" data-action="copy-link" data-url="${esc(url)}">Copiar</button></div><p class="small">Válido até ${dateLabel(result.expiresAt)}. Envie o link por um canal seguro.</p>`;
      toast('Link de recuperação gerado.');
    }
  } catch(error) { toast(error.message,true); }
  finally { if(button) button.disabled=false; }
}

async function render() {
  const current=++state.renderId; html('<div class="loading"><div class="spinner" aria-hidden="true"></div>Carregando…</div>');
  try {
    if (!state.configLoaded) {
      try { state.config={...state.config,...await api('/api/config')}; } catch { /* Usa os valores padrão. */ }
      state.configLoaded=true; state.month=toLocalParts(new Date().toISOString(),state.config.defaultTimezone).date.slice(0,7); document.title=`${state.config.brandName} · Gestão de eventos`;
    }
    if (!state.user) { try { state.user=(await api('/api/me')).user; } catch { state.user=null; } }
    if (current!==state.renderId) return;
    const path=decodeURIComponent(location.pathname); const params=new URLSearchParams(location.search);
    if (!state.user) {
      if (path==='/convite') {
        const token=params.get('token'); if(!token) throw new Error('O convite não contém um token.');
        const {invitation}=await api(`/api/invitations/preview?token=${encodeURIComponent(token)}`); return invitePage(invitation,token);
      }
      if (path==='/convite-equipe') {
        const token=params.get('token'); if(!token) throw new Error('O convite não contém um token.');
        const {invitation}=await api(`/api/team/invitations/preview?token=${encodeURIComponent(token)}`); return teamInvitePage(invitation,token);
      }
      if (path==='/recuperar') { const token=params.get('token'); if(!token) throw new Error('O link de recuperação está incompleto.'); const preview=await api(`/api/auth/reset/preview?token=${encodeURIComponent(token)}`); return resetPage(token,preview.email); }
      if (path!=='/' && path!=='/entrar') history.replaceState({},'','/entrar');
      return loginPage();
    }
    if (state.user.role==='client') {
      if (path==='/portal' || path==='/' || path==='/entrar') return await portalHomePage();
      const match=path.match(/^\/portal\/eventos\/([^/]+)$/); if(match) return await portalEventPage(match[1]);
      return go('/portal');
    }
    if (path==='/' || path==='/entrar' || path==='/app') return allowed('dashboard')?await dashboardPage():go(defaultAdminRoute());
    if (path==='/app/sem-acesso') return html(adminShell('<div class="empty-card"><h1>Sem módulos liberados</h1><p>Peça ao proprietário que habilite ao menos um módulo para sua conta.</p></div>',path));
    if (path==='/app/eventos') return await eventsPage();
    if (path==='/app/eventos/novo') return await eventFormPage();
    if (path==='/app/clientes') return await clientsPage();
    if (path==='/app/clientes/novo') return await clientFormPage();
    if (path==='/app/calendario') return await calendarPage();
    if (path==='/app/equipe') return await teamPage();
    if (path==='/app/financeiro') return await financePage();
    if (path==='/app/financeiro/novo') return await financeNewPage();
    const financeAccount=path.match(/^\/app\/financeiro\/contas\/([^/]+)$/); if(financeAccount) return await financeAccountPage(financeAccount[1]);
    const edit=path.match(/^\/app\/eventos\/([^/]+)\/editar$/); if(edit) return await eventFormPage(edit[1]);
    const clientEdit=path.match(/^\/app\/clientes\/([^/]+)\/editar$/); if(clientEdit) return await clientFormPage(clientEdit[1]);
    const detail=path.match(/^\/app\/eventos\/([^/]+)$/); if(detail) return await eventDetailPage(detail[1]);
    return go('/app');
  } catch(error) {
    if (current!==state.renderId) return;
    if (error.status===401) { state.user=null; history.replaceState({},'','/entrar'); return loginPage(); }
    errPage(error.message,state.user?.role==='client'?'/portal':'/app');
  }
}

document.addEventListener('click',async event=>{
  const link=event.target.closest('a[data-nav]'); if(link) { event.preventDefault(); go(link.dataset.nav); return; }
  const action=event.target.closest('[data-action]'); if(!action) return;
  if (action.dataset.action==='logout') { try { await api('/api/auth/logout',{method:'POST'}); } catch {} state.user=null; go('/entrar'); }
  if (action.dataset.action==='month-prev' || action.dataset.action==='month-next') {
    const [y,m]=state.month.split('-').map(Number); const delta=action.dataset.action==='month-prev'?-1:1; const d=new Date(Date.UTC(y,m-1+delta,1)); state.month=d.toISOString().slice(0,7); render();
  }
  if (action.dataset.action==='copy-link') {
    try { await navigator.clipboard.writeText(action.dataset.url); toast('Link copiado.'); } catch { toast('Não foi possível copiar. Selecione o link e copie manualmente.',true); }
  }
  if (action.dataset.action==='team-reinvite') {
    action.disabled=true;
    try {
      const result=await api(`/api/team/${encodeURIComponent(action.dataset.id)}/invitations`,{method:'POST',body:'{}'});
      const url=new URL(result.inviteUrl,location.origin).href;
      app.querySelector(`#team-invite-${CSS.escape(action.dataset.id)}`).innerHTML=`<div class="invite-result"><input aria-label="Novo convite da equipe" readonly value="${esc(url)}"><button type="button" class="button secondary small" data-action="copy-link" data-url="${esc(url)}">Copiar</button></div>`;
      toast('Novo convite gerado.');
    } catch(error) { toast(error.message,true); } finally { action.disabled=false; }
  }
});
document.addEventListener('submit',event=>{ const form=event.target.closest('form[data-form]'); if(!form) return; event.preventDefault(); handleForm(form); });
document.addEventListener('change',event=>{const form=event.target.closest('form[data-form="finance-create"]'); if(!form) return; if(['amount','dueDate','installmentCount'].includes(event.target.name)) renderInstallmentInputs(form); if(['eventId','direction'].includes(event.target.name)) updateFinanceClients(form).catch(error=>toast(error.message,true)); if(event.target.name==='direction'&&event.target.value==='payable') form.elements.namedItem('sharedWithClient').checked=false;});
window.addEventListener('popstate',render);
if ('serviceWorker' in navigator && (location.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname))) navigator.serviceWorker.register('/sw.js').catch(()=>{});
render();
