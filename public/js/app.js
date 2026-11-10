/* =====================================================================
   Centro Actoral de Boyacá — utilidades compartidas
   ===================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------------------------------------------------------- sesión
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
const S = { token: store.get('ca_token'), rol: store.get('ca_rol'), nombre: store.get('ca_nombre'), foto: store.get('ca_foto') };
function login(d) {
  store.set('ca_token', d.token); store.set('ca_rol', d.rol); store.set('ca_nombre', d.nombre || ''); store.set('ca_foto', d.foto || null);
  Object.assign(S, { token: d.token, rol: d.rol, nombre: d.nombre, foto: d.foto });
}
function logout(go = true) {
  ['ca_token', 'ca_rol', 'ca_nombre', 'ca_foto'].forEach(k => store.set(k, null));
  Object.assign(S, { token: null, rol: null, nombre: null, foto: null });
  if (go) location.href = 'index.html';
}

// ---------------------------------------------------------- API
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let data = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; data = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, { method, headers, body: data }); }
  catch { throw new Error('No hay conexión con el servidor. ¿Está corriendo la API?'); }
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 401 && S.token && path !== '/api/login') {
    logout(false);
    toast('Tu sesión expiró. Inicia sesión de nuevo.', 'err');
    setTimeout(() => location.href = 'login.html?next=' + encodeURIComponent(location.pathname.slice(1) + location.search), 900);
  }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Ocurrió un error (' + r.status + ')'), { status: r.status, data: d });
  return d;
}

// ---------------------------------------------------------- catálogos (códigos del backend -> etiquetas)
let _cat;
const catalogos = () => _cat || (_cat = api('/api/catalogos').then(c => (window.CATALOGOS = c)).catch(() => (window.CATALOGOS = {})));
const etq = (lista, cod) => (((window.CATALOGOS || {})[lista] || []).find(x => x.codigo === cod) || {}).etiqueta || cod || '';
const edadAparente = a => a.edad_aparente_min == null ? '' : a.edad_aparente_min === a.edad_aparente_max ? `${a.edad_aparente_min} años` : `${a.edad_aparente_min}–${a.edad_aparente_max} años`;
// Embed seguro de videos (YouTube/Vimeo): la URL de embed la calcula el servidor
const embedVideo = v => v.url_embed ? `<div class="vid-card" style="aspect-ratio:16/9"><iframe src="${esc(v.url_embed)}" style="width:100%;height:100%;border:0" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
  : /^(https?:\/\/|\/uploads\/)/.test(v.url || '') && /\.(mp4|webm|mov)(\?|$)/i.test(v.url) ? `<div class="vid-card"><video src="${esc(v.url)}" controls preload="metadata"></video></div>`
  : `<a class="card flex" href="${esc(v.url)}" target="_blank" rel="noopener">${ic('play_circle', 'style="font-size:40px;color:var(--turq)"')}<div><b>${esc(v.titulo || 'Video')}</b><br><span class="small muted">Abrir enlace</span></div></a>`;

// ---------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, extra = '') => `<span class="material-icons-round" ${extra}>${n}</span>`;
const qs = k => new URLSearchParams(location.search).get(k);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fecha(d, larga = false) {
  if (!d) return '';
  const x = new Date(d); if (isNaN(x)) return '';
  return larga ? x.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : `${x.getDate()} ${MESES[x.getMonth()]} ${x.getFullYear()}`;
}
const fechaHora = d => d ? `${fecha(d)}, ${new Date(d).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}` : '';
function hace(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'Hace un momento';
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `Hace ${Math.floor(s / 86400)} d`;
  return fecha(d);
}
const toInputDate = d => d ? new Date(new Date(d) - new Date(d).getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : '';
const toInputDT = d => d ? new Date(new Date(d) - new Date(d).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
function rolLabel(a) {
  if (a.ocupacion) return a.ocupacion.split(/[·,|]/)[0].trim();
  return a.genero === 'FEMENINO' ? 'Actriz' : a.genero === 'MASCULINO' ? 'Actor' : 'Talento';
}
const bg = url => url ? `background-image:url('${esc(url)}')` : '';
function debounce(fn, ms = 350) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Comprime imágenes en el navegador antes de subir (zonas rurales / baja conexión)
function comprimir(file, max = 1600, q = .85) {
  return new Promise(res => {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif') return res(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 900e3) return res(file);
      const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => res(new File([b], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })), 'image/jpeg', q);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------- toast / modal / drawer
function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'err' ? 'err' : '');
  t.innerHTML = ic(type === 'err' ? 'error' : 'check_circle') + `<span>${esc(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = 0; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3600);
}
function modal({ title = '', body = '', foot = '', size = '', petrol = false, icon = '', onClose } = {}) {
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-h ${petrol ? 'petrol' : ''}">${icon ? ic(icon, `style="color:${petrol ? 'var(--lime)' : 'var(--petrol)'};font-size:26px"`) : ''}<h2>${title}</h2><button class="x" aria-label="Cerrar">${ic('close')}</button></div>` : ''}
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  document.body.appendChild(w);
  document.body.style.overflow = 'hidden';
  const close = () => { w.remove(); if (!$('.modal-wrap') && !$('.drawer-wrap')) document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  const x = $('.x', w); if (x) x.onclick = close;
  return { el: w, close, $: s => $(s, w), $$: s => $$(s, w) };
}
function confirmBox({ title, text = '', ok = 'Confirmar', danger = false, input = null, icon = 'help' }) {
  return new Promise(resolve => {
    const m = modal({
      size: 'sm',
      body: `<div style="padding-top:22px">
        <div class="tile" style="background:var(--turq);margin-bottom:14px">${ic(icon)}</div>
        <h2 style="margin-bottom:6px">${esc(title)}</h2><p class="muted small">${esc(text)}</p>
        ${input ? `<div class="field"><label>${esc(input.label)} <span class="muted small">${input.optional ? '(opcional)' : ''}</span></label>
          <textarea id="cb-in" placeholder="${esc(input.placeholder || '')}" style="min-height:90px"></textarea></div>` : ''}
      </div>`,
      foot: `<button class="btn outline" data-cb-no>Cancelar</button><button class="btn ${danger ? 'danger' : ''}" data-cb-ok>${esc(ok)}</button>`,
      onClose: () => resolve(false)
    });
    m.$('[data-cb-no]').onclick = () => m.close();
    m.$('[data-cb-ok]').onclick = () => {
      const v = input ? m.$('#cb-in').value.trim() : true;
      if (input && !input.optional && !v) { m.$('#cb-in').focus(); return; }
      m.el.remove(); document.body.style.overflow = ''; resolve(input ? { value: v } : true);
    };
  });
}
function drawer(html) {
  const w = document.createElement('div');
  w.className = 'drawer-wrap';
  w.innerHTML = `<div class="drawer">${html}</div>`;
  document.body.appendChild(w); document.body.style.overflow = 'hidden';
  const close = () => { w.remove(); if (!$('.modal-wrap')) document.body.style.overflow = ''; };
  w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  $$('[data-close]', w).forEach(b => b.onclick = close);
  return { el: w, close };
}
function lightbox(url) {
  const m = modal({ size: 'xl', body: `<img src="${esc(url)}" style="width:100%;max-height:80vh;object-fit:contain;margin-top:20px;border-radius:14px">` });
  m.el.querySelector('.modal-b').style.padding = '6px 20px 20px';
}

// ---------------------------------------------------------- decoraciones SVG
const SVG = {
  wave: `<svg class="deco-wave" viewBox="0 0 340 90" preserveAspectRatio="none" aria-hidden="true">
    <path d="M14 74 C 80 8, 170 4, 228 44 S 318 64, 332 18" stroke="#1FD1B0" stroke-width="18" fill="none" stroke-linecap="round"/>
    <path d="M70 82 C 130 44, 196 44, 256 66" stroke="#13707F" stroke-width="6" fill="none" stroke-linecap="round" opacity=".55"/></svg>`,
  blobsL: `<svg width="380" height="120" viewBox="0 0 380 120" style="left:0" aria-hidden="true">
    <path d="M0 120 C6 60 64 26 116 48 C158 66 156 120 156 120Z" fill="#1FD1B0"/>
    <path d="M96 120 C104 76 156 58 196 78 C226 94 214 120 214 120Z" fill="#B9F53D"/>
    <circle cx="196" cy="38" r="11" fill="#B9F53D"/><path d="M36 120 C52 92 84 88 102 106 L102 120Z" fill="#0E5B69" opacity=".85"/></svg>`,
  blobsR: `<svg width="300" height="110" viewBox="0 0 300 110" style="right:0" aria-hidden="true">
    <path d="M300 110 C296 52 250 22 204 40 C168 56 172 110 172 110Z" fill="#B9F53D"/>
    <path d="M218 110 C212 74 170 58 136 76 C110 90 122 110 122 110Z" fill="#1FD1B0"/>
    <circle cx="140" cy="44" r="8" fill="#1FD1B0"/></svg>`,
  banner: `<svg viewBox="0 0 1200 110" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 40 C 200 0, 420 10, 600 60 L600 110 L0 110Z" fill="#1FD1B0"/>
    <path d="M760 70 C 900 20, 1060 0, 1200 10 L1200 110 L760 110Z" fill="#B9F53D"/>
    <path d="M0 110 C 300 70, 900 70, 1200 110Z" fill="#fff"/></svg>`,
  fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.5V11H7v4h2.5v8h4v-8H17l.6-4h-4.1V8.7c0-.4.3-.7.5-.7z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2c-.2-1.6-1-2.6-2.6-2.8C17.2 5 12 5 12 5s-5.2 0-7.4.4C3 5.6 2.2 6.6 2 8.2 1.8 9.5 1.8 12 1.8 12s0 2.5.2 3.8c.2 1.6 1 2.6 2.6 2.8C6.8 19 12 19 12 19s5.2 0 7.4-.4c1.6-.2 2.4-1.2 2.6-2.8.2-1.3.2-3.8.2-3.8s0-2.5-.2-3.8zM10 15V9l5.2 3z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>'
};

// ---------------------------------------------------------- tarjetas reutilizables
function actorCard(a, { dark = false } = {}) {
  return `<a class="actor-card ${dark ? 'dark' : ''}" href="perfil.html?id=${a.actor_id}" style="${bg(a.foto)}" title="${esc(a.nombre)}">
    ${a.foto ? '' : `<div class="ph-empty">${ic('person')}</div>`}
    <div class="nameplate"><span>${esc(a.nombre)}</span><span class="chip">${esc(rolLabel(a))}</span></div></a>`;
}
function courseCard(c) {
  return `<a class="course-card" href="curso.html?id=${c.curso_id}">
    <div class="img" style="${bg(c.imagen_url)}">${c.imagen_url ? '' : ic('theater_comedy')}</div>
    <div class="body"><div class="cat">${esc(c.categoria || 'Formación')}</div><div class="t">${esc(c.titulo)}</div>
      <div class="stats"><span>${ic('groups')} ${c.inscritos || 0} inscritos</span>${c.duracion_horas ? `<span>${ic('schedule')} ${c.duracion_horas} h</span>` : ''}<span>${ic('place')} ${esc(etq('modalidades', c.modalidad) || 'Presencial')}</span></div></div></a>`;
}
function noticiaModal(n) {
  modal({
    size: 'lg', title: esc(n.titulo), icon: 'newspaper',
    body: `${n.imagen_url ? `<img src="${esc(n.imagen_url)}" style="width:100%;max-height:340px;object-fit:cover;border-radius:16px;margin-bottom:16px">` : ''}
      <div class="flex wrap mb1">${n.categoria ? `<span class="chip">${esc(n.categoria)}</span>` : ''}<span class="muted small">${ic('event')} ${fecha(n.publicado_en, true)}</span></div>
      <p style="font-weight:600">${esc(n.resumen_para_carta)}</p><div class="rich">${n.resumen_para_galeria || ''}</div>
      ${n.enlace ? `<a class="link mt1" href="${esc(n.enlace)}" target="_blank" rel="noopener">Ver fuente ${ic('north_east')}</a>` : ''}`
  });
}
function legal(tipo) {
  const t = {
    privacidad: ['Política de privacidad', `<p>El Centro Actoral de Boyacá trata los datos personales de actores, actrices y acudientes conforme a la <b>Ley 1581 de 2012</b> y el Decreto 1377 de 2013.</p>
      <p>Los datos se usan únicamente para el Registro Departamental de talento actoral, la divulgación de perfiles aprobados en la vitrina pública y la gestión de convocatorias y procesos de formación.</p>
      <p>Puedes solicitar la consulta, actualización o eliminación de tus datos escribiendo al correo de contacto del Centro Actoral.</p>`],
    terminos: ['Términos de uso', `<p>Al registrarte aceptas que la información suministrada es veraz y que autorizas la publicación de tu perfil (fotografías, video y datos artísticos) una vez sea aprobado por el equipo del Centro Actoral.</p>
      <p>El Centro Actoral puede restringir perfiles con contenido inapropiado o que incumplan estas condiciones.</p>`],
    ordenanza: ['Ordenanza 045 de 2024', '<p>Marco normativo departamental que da origen al Centro Actoral de Boyacá y al Registro Departamental de talento actoral.</p><p class="muted small">Reemplaza este texto con el contenido oficial de la ordenanza.</p>']
  }[tipo];
  modal({ title: t[0], body: t[1], icon: 'gavel' });
}

// ---------------------------------------------------------- estructura de página
const MENU_ACTOR = [
  ['home', 'Home', 'index.html', 'home'],
  ['postulaciones', 'Postulaciones', 'postulaciones.html', 'campaign'],
  ['aplicaciones', 'Aplicaciones', 'aplicaciones.html', 'assignment'],
  ['perfil', 'Mi perfil', 'cuenta.html', 'person'],
  ['actores', 'Explorar talento', 'actores.html', 'groups']
];
const MENU_ADMIN = [
  ['panel', 'Panel principal', 'admin.html', 'dashboard'],
  ['aprobacion', 'Aprobación de perfiles', 'admin-aprobacion.html', 'how_to_reg'],
  ['perfiles', 'Administración de perfiles', 'admin-perfiles.html', 'manage_accounts'],
  ['contenido', 'Cursos, convocatorias y noticias', 'admin-contenido.html', 'edit_note'],
  ['historial', 'Historial / Auditoría', 'admin-historial.html', 'history'],
  ['sitio', 'Ver sitio público', 'index.html', 'public']
];

function shell({ active = '', admin = false, require = null } = {}) {
  if (require && S.rol !== require) {
    location.replace('login.html?next=' + encodeURIComponent(location.pathname.slice(1) + location.search));
    return false;
  }
  const page = $('#page');
  const menu = admin ? MENU_ADMIN : MENU_ACTOR;
  const side = document.createElement('aside');
  side.className = 'sidebar';
    side.innerHTML = `<nav>${menu.map(([k, t, href, icn]) => `<a href="${href}" class="${k === active ? 'on' : ''}">${ic(icn)} ${t}${k === 'aprobacion' ? '<span class="badge hidden" id="badge-pend"></span>' : ''}</a>`).join('')}</nav>
    <div class="side-foot">${S.rol ? `<a href="#" id="side-logout">Cerrar sesión</a>` : `<a href="login.html">Iniciar sesión</a>`}</div>`;
  const back = document.createElement('div'); back.className = 'backdrop';

  const top = document.createElement('header');
  top.className = 'topbar' + (admin ? ' admin' : '');
  const avatar = S.foto ? `<img src="${esc(S.foto)}" alt="">` : ic('person');
  top.innerHTML = `<button class="burger" aria-label="Abrir o cerrar menú"><span></span><span></span><span></span></button>
    <a class="brand" href="${admin ? 'admin.html' : 'index.html'}"><span class="logo">${ic('theater_comedy')}</span>
      <span class="txt"><b>${admin ? 'Centro Actoral · Administrador' : 'CENTRO ACTORAL'}</b>${admin ? '' : '<small>DE BOYACÁ</small>'}</span></a>
    ${admin ? '<div style="flex:1"></div>' : `<form class="search" role="search"><input name="q" placeholder="Buscar actores, actrices o perfiles..." value="${esc(qs('q') || '')}" aria-label="Buscar"><button aria-label="Buscar">${ic('search')}</button></form>`}
    <button class="avatar-btn" aria-label="Cuenta">${avatar}</button>
    <div class="user-menu">${userMenu()}</div>`;

  const main = document.createElement('div'); main.className = 'main';
  page.parentNode.insertBefore(main, page);
  main.appendChild(top); main.appendChild(page);
  main.insertAdjacentHTML('beforeend', footerHTML());
  document.body.prepend(side, back);

  // menú lateral desplegable (se recuerda en PC)
  const mobile = () => innerWidth < 1024;
  if (store.get('ca_side') === 'closed') document.body.classList.add('side-closed');
  const toggle = () => mobile() ? document.body.classList.toggle('side-open-m') : (document.body.classList.toggle('side-closed'),
    store.set('ca_side', document.body.classList.contains('side-closed') ? 'closed' : 'open'));
    $('.burger', top).onclick = toggle;
  back.onclick = () => document.body.classList.remove('side-open-m');

  // buscador
  const f = $('.search', top);
  if (f) f.onsubmit = e => { e.preventDefault(); location.href = 'actores.html?q=' + encodeURIComponent(f.q.value.trim()); };

  // botón de cuenta (arriba a la derecha)
  const um = $('.user-menu', top);
  $('.avatar-btn', top).onclick = e => { e.stopPropagation(); um.classList.toggle('on'); };
  document.addEventListener('click', e => { if (!um.contains(e.target)) um.classList.remove('on'); });
  $$('[data-logout]', um).forEach(b => b.onclick = () => logout());
  const sl = $('#side-logout', side); if (sl) sl.onclick = e => { e.preventDefault(); logout(); };
  $$('[data-legal]').forEach(a => a.onclick = e => { e.preventDefault(); legal(a.dataset.legal); });

  if (admin) api('/api/admin/resumen').then(r => { const b = $('#badge-pend'); if (b && r.pendientes) { b.textContent = r.pendientes; b.classList.remove('hidden'); } }).catch(() => {});
  return true;
}
function userMenu() {
  if (S.rol === 'admin') return `<div class="um-head"><b>${esc(S.nombre || 'Administrador')}</b><span class="small muted">Administrador</span></div>
    <a href="admin.html">${ic('dashboard')} Panel administrador</a><a href="admin-aprobacion.html">${ic('how_to_reg')} Aprobación de perfiles</a>
    <a href="index.html">${ic('public')} Ver sitio público</a><button class="um-item" data-logout>${ic('logout')} Cerrar sesión</button>`;
  if (S.rol === 'actor') return `<div class="um-head"><b>${esc(S.nombre || 'Mi cuenta')}</b><span class="small muted">Actor / actriz</span></div>
    <a href="cuenta.html">${ic('person')} Mi perfil</a><a href="editar.html">${ic('edit')} Editar perfil</a>
    <a href="postulaciones.html">${ic('campaign')} Mi postulación</a><a href="aplicaciones.html">${ic('assignment')} Mis aplicaciones</a>
    <button class="um-item" data-logout>${ic('logout')} Cerrar sesión</button>`;
  return `<div class="um-head"><b>¡Bienvenido!</b><span class="small muted">Actores y administradores</span></div>
    <a href="login.html">${ic('login')} Iniciar sesión</a><a href="preparar.html">${ic('how_to_reg')} Postularme como actor</a>`;
}
function footerHTML() {
  return `<div class="foot-deco">${SVG.blobsL}${SVG.blobsR}</div>
  <footer class="site"><div class="in">
    <div><div class="brand"><span class="logo">${ic('theater_comedy')}</span><span><b>CENTRO ACTORAL</b><small>DE BOYACÁ</small></span></div>
      <p class="mt2">Formamos y visibilizamos el talento actoral de Boyacá y llevamos las artes escénicas a todos los rincones del departamento.</p>
      <div class="soc"><a href="#" aria-label="Facebook">${SVG.fb}</a><a href="#" aria-label="Instagram">${SVG.ig}</a><a href="#" aria-label="YouTube">${SVG.yt}</a><a href="#" aria-label="X">${SVG.x}</a></div></div>
    <div><h4>CONTACTO</h4>
      <div class="ct"><span class="i">${ic('place')}</span><span>[Dirección del Centro Actoral]<br>Tunja, Boyacá, Colombia</span></div>
      <div class="ct"><span class="i">${ic('call')}</span><span>[+57 (8) 000 0000]</span></div>
      <div class="ct"><span class="i">${ic('mail')}</span><span>[contacto@centroactoral.gov.co]</span></div></div>
    <div class="legal"><h4>INFORMACIÓN LEGAL</h4><a data-legal="ordenanza">Ordenanza 045 de 2024</a><a data-legal="privacidad">Política de Privacidad</a><a data-legal="terminos">Términos de Uso</a></div>
  </div><div class="bottom">© ${new Date().getFullYear()} Centro Actoral de Boyacá. Todos los derechos reservados.<br>Gobierno Departamental de Boyacá.
    <div style="color:#fff;opacity:.8;margin-top:10px">Una iniciativa de:</div><b>Secretaría de Cultura y Patrimonio</b></div></footer>`;
}
