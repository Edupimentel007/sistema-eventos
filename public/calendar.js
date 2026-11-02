// Agenda administrativa: as datas de exibição usam o fuso do próprio evento.
export function createCalendarUi({api,html,adminShell,allowed,esc,icon,toLocalParts,badge,dateOnlyLabel,timeLabel,state}) {
  const dateValue = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ? value : toLocalParts(new Date().toISOString(),state.config.defaultTimezone).date;
  const utc = date => new Date(`${date}T12:00:00Z`);
  const iso = date => date.toISOString().slice(0,10);
  const addDays = (date,count) => { const d=utc(date); d.setUTCDate(d.getUTCDate()+count); return iso(d); };
  const addMonths = (date,count) => { const d=utc(date); const day=d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+count); const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(day,max)); return iso(d); };
  const monday = date => addDays(date,-((utc(date).getUTCDay()+6)%7));
  const monthStart = date => `${date.slice(0,7)}-01`;
  const monthEnd = date => addDays(addMonths(monthStart(date),1),-1);
  const path = (view,date) => `/app/calendario?view=${view}&date=${date}`;
  const monthTitle = date => new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(utc(date));
  const longDay = date => new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(utc(date));
  const weekday = date => new Intl.DateTimeFormat('pt-BR',{weekday:'short',timeZone:'UTC'}).format(utc(date)).replace('.','');
  const shortDate = date => new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'UTC'}).format(utc(date)).replace('.','');
  const eventDate = event => toLocalParts(event.startAt,event.timezone).date;
  const eventMinutes = event => {const t=toLocalParts(event.startAt,event.timezone).time; return Number(t.slice(0,2))*60+Number(t.slice(3,5));};
  const eventDuration = event => {
    if(!event.endAt) return 90;
    const start=new Date(event.startAt).getTime(), end=new Date(event.endAt).getTime();
    return Math.max(45,Math.min(600,Math.round((end-start)/60000)));
  };
  const location = event => event.receptionName||event.ceremonyName||event.city||'Local a definir';
  const eventChip = (event,compact=false) => {
    const content=`<span class="cal-event-time">${timeLabel(event.startAt,event.timezone)}</span><span class="cal-event-name">${esc(event.name)}</span>`;
    return allowed('events')
      ? `<a class="schedule-event ${esc(event.status)}${compact?' compact':''}" href="/app/eventos/${esc(event.id)}" data-nav="/app/eventos/${esc(event.id)}" title="${esc(event.name)}">${content}</a>`
      : `<span class="schedule-event ${esc(event.status)}${compact?' compact':''}" title="${esc(event.name)}">${content}</span>`;
  };
  const listRow = event => {
    const content=`<span class="schedule-list-date"><strong>${esc(eventDate(event).slice(8,10))}</strong><small>${esc(shortDate(eventDate(event)).split(' ')[1]||'')}</small></span><span class="schedule-list-main"><strong>${esc(event.name)}</strong><small>${timeLabel(event.startAt,event.timezone)} · ${esc(location(event))}</small></span>${badge(event.status)}${icon('chevron')}`;
    return allowed('events')
      ? `<a class="schedule-list-row" href="/app/eventos/${esc(event.id)}" data-nav="/app/eventos/${esc(event.id)}">${content}</a>`
      : `<div class="schedule-list-row">${content}</div>`;
  };
  const sorted = events => events.sort((a,b)=>new Date(a.startAt)-new Date(b.startAt));
  async function loadRange(start,end) {
    const months=new Set(); for(let d=start;d<=end;d=addDays(d,1)) months.add(d.slice(0,7));
    const responses=await Promise.all([...months].map(m=>api(`/api/calendar?month=${m}`)));
    return sorted([...new Map(responses.flatMap(r=>r.events||[]).map(e=>[e.id,e])).values()]);
  }
  const dayEvents=(events,date)=>events.filter(e=>eventDate(e)===date);
  const byRange=(events,start,end)=>events.filter(e=>eventDate(e)>=start&&eventDate(e)<=end);
  function monthGrid(events,date,today) {
    const start=monday(monthStart(date)); const end=addDays(monday(monthEnd(date)),6);
    const days=[];for(let d=start;d<=end;d=addDays(d,1)) days.push(d);
    return `<div class="schedule-month" role="grid" aria-label="Mês de ${esc(monthTitle(date))}"><div class="schedule-weekdays">${['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(x=>`<span>${x}</span>`).join('')}</div><div class="schedule-month-days">${days.map(d=>{const items=dayEvents(events,d);return `<div class="schedule-month-day ${d.slice(0,7)!==date.slice(0,7)?'outside':''} ${d===today?'today':''}" role="gridcell"><a class="schedule-day-number" href="${path('day',d)}" data-nav="${path('day',d)}" aria-label="${esc(longDay(d))}">${Number(d.slice(8,10))}</a><div class="schedule-month-events">${items.slice(0,3).map(e=>eventChip(e,true)).join('')}${items.length>3?`<a class="schedule-more" href="${path('day',d)}" data-nav="${path('day',d)}">+${items.length-3} eventos</a>`:''}</div>${items.length?`<span class="schedule-dots" aria-hidden="true">${items.slice(0,3).map(e=>`<i class="${esc(e.status)}"></i>`).join('')}</span>`:''}</div>`;}).join('')}</div></div>`;
  }
  function timeline(events,days) {
    const hours=Array.from({length:17},(_,i)=>i+6);
    const labels=`<div class="schedule-hour-labels">${hours.map(h=>`<span>${String(h).padStart(2,'0')}:00</span>`).join('')}</div>`;
    const cols=days.map(d=>`<div class="schedule-time-col"><div class="schedule-time-heading"><a href="${path('day',d)}" data-nav="${path('day',d)}">${esc(weekday(d))} <strong>${Number(d.slice(8,10))}</strong></a></div><div class="schedule-time-body">${hours.slice(0,-1).map(()=>'<span class="schedule-hour-line"></span>').join('')}${dayEvents(events,d).map(e=>{const top=Math.max(0,Math.min(940,eventMinutes(e)-360));const height=Math.max(42,Math.min(eventDuration(e),960-top));return `<div class="schedule-positioned" style="top:${top}px;height:${height}px">${eventChip(e)}</div>`;}).join('')}</div></div>`).join('');
    return `<div class="schedule-timeline-scroll"><div class="schedule-timeline ${days.length===1?'single':''}">${labels}<div class="schedule-time-cols">${cols}</div></div></div>`;
  }
  function groupedList(events,start,end,empty) {
    const relevant=byRange(events,start,end);
    if(!relevant.length) return `<div class="schedule-empty">${empty}</div>`;
    const groups=new Map(); for(const e of relevant){const d=eventDate(e);if(!groups.has(d))groups.set(d,[]);groups.get(d).push(e);}
    return `<div class="schedule-agenda">${[...groups].map(([d,items])=>`<section><h3>${esc(longDay(d))}</h3>${items.map(listRow).join('')}</section>`).join('')}</div>`;
  }
  async function page() {
    if(!allowed('calendar')) throw new Error('Você não tem acesso ao calendário.');
    const params=new URLSearchParams(window.location.search);const today=toLocalParts(new Date().toISOString(),state.config.defaultTimezone).date;const date=dateValue(params.get('date')||today);
    const view=['month','week','day','list'].includes(params.get('view'))?params.get('view'):'month';
    const start=view==='week'?monday(date):view==='day'?date:monthStart(date);
    const end=view==='week'?addDays(start,6):view==='day'?date:monthEnd(date);
    const events=await loadRange(view==='month'?monday(start):start,view==='month'?addDays(monday(end),6):end);
    const shift=view==='day'?(d,delta)=>addDays(d,delta):view==='week'?(d,delta)=>addDays(d,delta*7):(d,delta)=>addMonths(d,delta);
    const title=view==='day'?longDay(date):view==='week'?`${shortDate(start)} – ${shortDate(end)}`:monthTitle(date);
    const days=view==='day'?[date]:Array.from({length:7},(_,i)=>addDays(start,i));
    const tabs=[['month','Mês'],['week','Semana'],['day','Dia'],['list','Lista']].map(([key,label])=>`<a class="${key===view?'active':''}" href="${path(key,date)}" data-nav="${path(key,date)}" aria-current="${key===view?'page':'false'}">${label}</a>`).join('');
    const content=view==='month'?monthGrid(events,date,today):view==='list'?groupedList(events,start,end,'Nenhum evento neste mês.'):view==='day'?timeline(events,days):`<div class="schedule-week-desktop">${timeline(events,days)}</div><div class="schedule-week-mobile">${groupedList(events,start,end,'Nenhum evento nesta semana.')}</div>`;
    const monthCount=byRange(events,start,end).length;
    html(adminShell(`<div class="page-head schedule-page-head"><div><div class="eyebrow">Agenda da empresa</div><h1>Calendário</h1><p>Eventos e compromissos em uma visão clara.</p></div>${allowed('events','write')?`<a class="button" href="/app/eventos/novo" data-nav="/app/eventos/novo">${icon('plus')} Novo evento</a>`:''}</div><div class="schedule-toolbar"><div class="schedule-navigation"><a class="button secondary small" href="${path(view,today)}" data-nav="${path(view,today)}">Hoje</a><a class="schedule-arrow" href="${path(view,shift(date,-1))}" data-nav="${path(view,shift(date,-1))}" aria-label="Anterior">‹</a><a class="schedule-arrow" href="${path(view,shift(date,1))}" data-nav="${path(view,shift(date,1))}" aria-label="Próximo">›</a><strong>${esc(title)}</strong></div><nav class="schedule-views" aria-label="Visualização do calendário">${tabs}</nav></div><div class="schedule-surface">${content}</div>${view==='month'?`<section class="panel section"><div class="panel-head"><h2>Eventos de ${esc(monthTitle(date))}</h2><span class="small">${monthCount} registro${monthCount===1?'':'s'}</span></div>${groupedList(events,start,end,'Nenhum evento neste mês.')}</section>`:''}<div class="notice section">Reuniões, visitas e tarefas serão exibidas quando esses módulos estiverem disponíveis.</div>`, '/app/calendario'));
  }
  return {page};
}
