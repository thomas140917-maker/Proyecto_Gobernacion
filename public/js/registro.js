/* Registro de actores en 5 pasos (ventana emergente) */
const AREAS = ['Teatro', 'Cine', 'Televisión', 'Cortometraje', 'Publicidad', 'Doblaje'];
const ESPECIALIDADES = ['Drama', 'Comedia', 'Acción', 'Musical', 'Infantil', 'Histórico'];
const MUNICIPIOS = ['Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá', 'Paipa', 'Villa de Leyva', 'Puerto Boyacá', 'Moniquirá', 'Garagoa', 'Soatá',
  'Samacá', 'Ventaquemada', 'Tibasosa', 'Nobsa', 'Aquitania', 'Ráquira', 'Guateque', 'Miraflores', 'Socha', 'El Cocuy', 'Otro'];
const PRODUCCIONES = ['Cine', 'Televisión', 'Teatro', 'Cortometraje', 'Publicidad', 'Videoclip', 'Serie web', 'Otro'];
const opts = (lista, vacio = 'Sin especificar') => `<option value="">${vacio}</option>` + (lista || []).map(x => `<option value="${esc(x.codigo)}">${esc(x.etiqueta)}</option>`).join('');
const REDES = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'LinkedIn', 'Vimeo'];

async function abrirRegistro() {
  if (!window.CATALOGOS) { try { window.CATALOGOS = await api('/api/catalogos'); } catch { window.CATALOGOS = {}; } }
  if (S.rol === 'actor') { toast('Ya tienes un perfil registrado. Te llevamos a tu postulación.'); setTimeout(() => location.href = 'postulaciones.html', 900); return; }
  if (S.rol === 'admin') { toast('Cierra la sesión de administrador para registrar un actor.', 'err'); return; }
  const st = { paso: 1, foto: null, fotos: [], expN: 0 };
  const CAT = window.CATALOGOS || {};
  const chips = (arr, name) => arr.map(x => `<button type="button" class="opt" data-g="${name}" data-v="${esc(x)}">${esc(x)}</button>`).join('') +
    `<button type="button" class="opt" data-g="${name}" data-v="__otro">Otro</button>`;
  const m = modal({ size: 'lg reg', body: `
    <div class="reg-head">
      <div class="flex between"><span class="eyebrow">Registro de talento</span><button class="x icon-btn" style="border:0" aria-label="Cerrar">${ic('close')}</button></div>
      <div class="stepper" id="stepper">${['Datos personales', 'Perfil artístico', 'Experiencia', 'Material', 'Revisión'].map((t, i) => `<div class="st" data-s="${i + 1}"><div class="c">${i + 1}</div>${t}</div>`).join('')}</div>
    </div>
    <div class="reg-body">
      <div id="reg-err"></div>
      <form id="reg" autocomplete="off" onsubmit="return false">

      <section class="reg-step" data-s="1">
        <h2>1. Datos personales</h2><p class="muted small">Completa la información básica de tu registro.</p>
        <div class="field"><label>Nombre completo <span class="req">*</span></label><div class="inp-ic">${ic('person_outline')}<input name="nombre_completo" placeholder="Ej. María Pérez"></div></div>
        <div class="row2">
          <div class="field"><label>Tipo de documento <span class="req">*</span></label><select name="tipo_documento"><option value="CC">Cédula de ciudadanía</option><option value="CE">Cédula de extranjería</option><option value="PASAPORTE">Pasaporte</option></select></div>
          <div class="field"><label>Número de documento <span class="req">*</span></label><input name="numero_documento" placeholder="Ej. 12345678" inputmode="numeric"></div>
        </div>
        <div class="row2">
          <div class="field"><label>Fecha de nacimiento <span class="req">*</span></label><input type="date" name="fecha_nacimiento" max="${toInputDate(new Date())}"></div>
          <div class="field"><label>Ciudad / municipio <span class="req">*</span></label><input name="municipio" list="munis" placeholder="Ej. Tunja"><datalist id="munis">${MUNICIPIOS.map(x => `<option value="${x}">`).join('')}</datalist></div>
        </div>
        <div class="row2">
          <div class="field"><label>Correo electrónico <span class="req">*</span></label><div class="inp-ic">${ic('mail_outline')}<input type="email" name="correo" placeholder="Ej. maria@email.com"></div></div>
          <div class="field"><label>Teléfono <span class="req">*</span></label><div class="inp-ic">${ic('smartphone')}<input name="telefono" placeholder="Ej. 300 123 4567" inputmode="tel"></div></div>
        </div>
        <div class="row2">
          <div class="field"><label>Contraseña <span class="req">*</span></label><input type="password" name="contrasena" placeholder="Mínimo 8 caracteres"><div class="hint">Mínimo 8 caracteres, con letras y números.</div></div>
          <div class="field"><label>Confirmar contraseña <span class="req">*</span></label><input type="password" name="contrasena2"></div>
        </div>
        <div id="menor" class="hidden card" style="background:var(--soft);margin-bottom:16px">
          <b style="color:var(--ink)">${ic('family_restroom')} Eres menor de edad</b><p class="small muted">Según la Ley 1581 necesitamos los datos de tu acudiente legal y su autorización firmada.</p>
          <div class="row2"><div class="field"><label>Nombre del acudiente <span class="req">*</span></label><input name="acudiente_nombre"></div>
            <div class="field"><label>Documento del acudiente <span class="req">*</span></label><input name="acudiente_documento"></div></div>
          <div class="row2"><div class="field"><label>Teléfono del acudiente <span class="req">*</span></label><input name="acudiente_telefono"></div>
            <div class="field"><label>Correo del acudiente <span class="req">*</span></label><input type="email" name="acudiente_correo"></div></div>
          <div class="field mb0"><label>Autorización firmada (PDF o imagen) <span class="req">*</span></label><input type="file" name="autorizacion" accept="application/pdf,image/jpeg,image/png,image/webp"><div class="hint">Solo la ve el equipo del Centro Actoral. Máx. 5 MB.</div></div>
        </div>
        <label class="check"><input type="checkbox" name="acepta_terminos"> <span>Acepto el tratamiento de mis datos personales según la <a class="link" href="#" data-legal="privacidad">política de privacidad</a> y autorizo el uso de mi imagen (Ley 1581 de 2012).</span></label>
      </section>

      <section class="reg-step" data-s="2">
        <h2>2. Perfil artístico</h2><p class="muted small">Cuéntanos sobre tu perfil como actor.</p>
        <div class="field"><label>Nombre artístico (opcional)</label><div class="inp-ic">${ic('star_outline')}<input name="nombre_artistico" placeholder="Ej. Luna Torres"></div></div>
        <div class="field"><label>¿En qué áreas te desempeñas? <span class="req">*</span></label><div class="opt-group" id="g-areas">${chips(AREAS, 'areas')}</div>
          <input class="inp mt1 hidden" id="areas-otro" placeholder="Especifica otra área"></div>
        <div class="field"><label>Especialidades <span class="req">*</span></label><div class="opt-group" id="g-esp">${chips(ESPECIALIDADES, 'esp')}</div>
          <input class="inp mt1 hidden" id="esp-otro" placeholder="Especifica otra especialidad"></div>
        <div class="row2">
          <div class="field"><label>Género</label><select name="genero">${opts(CAT.generos, 'Prefiero no decir')}</select></div>
          <div class="field"><label>Estatura (cm)</label><input type="number" name="estatura_cm" min="50" max="250" placeholder="Ej. 168"></div>
        </div>
        <div class="row2">
          <div class="field"><label>Tono de piel</label><select name="tono_piel">${opts(CAT.tonos_piel)}</select></div>
          <div class="field"><label>Dialecto / acento</label><select name="dialecto">${opts(CAT.dialectos)}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Color de ojos</label><select name="color_ojos">${opts(CAT.colores_ojos)}</select></div>
          <div class="field"><label>Color de cabello</label><select name="color_cabello">${opts(CAT.colores_cabello)}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Edad aparente (desde)</label><input type="number" name="edad_aparente_min" min="0" max="100" placeholder="Ej. 22"></div>
          <div class="field"><label>Edad aparente (hasta)</label><input type="number" name="edad_aparente_max" min="0" max="100" placeholder="Ej. 30"></div>
        </div>
        <div class="field"><label>Provincia</label><select name="provincia">${opts(CAT.provincias)}</select></div>
        <div class="row2">
          <div class="field"><label>Nivel de experiencia</label><select name="nivel"><option>Principiante</option><option>Intermedio</option><option>Avanzado</option></select></div>
          <div class="field"><label>Ocupación artística</label><input name="ocupacion" placeholder="Ej. Actriz · Cantante · Bailarina"></div>
        </div>
        <div class="field"><label>Biografía (opcional)</label><textarea name="biografia" placeholder="Cuéntanos brevemente quién eres como artista..."></textarea></div>
      </section>

      <section class="reg-step" data-s="3">
        <h2>3. Experiencia profesional</h2>
        <div class="field"><label>¿Tienes experiencia profesional como actor? <span class="req">*</span></label>
          <div class="flex"><label class="check"><input type="radio" name="tiene_exp" value="si"> Sí</label><label class="check"><input type="radio" name="tiene_exp" value="no" checked> No</label></div>
          <div class="hint">Si respondiste que sí, agrega tus experiencias.</div></div>
        <div id="exps"></div>
        <button type="button" class="link hidden" id="add-exp">${ic('add')} Agregar otra experiencia</button>
      </section>

      <section class="reg-step" data-s="4">
        <h2>4. Material del actor</h2>
        <div class="field"><label>Fotografía de perfil <span class="req">*</span></label>
          <div class="photo-drop" id="pdrop" title="Arrastra tu foto aquí o haz clic"><span class="material-icons-round icon-person">person_outline</span><span class="cam">${ic('photo_camera')}</span></div>
          <input type="file" id="foto" accept="image/*" hidden><div class="hint">Arrastra la imagen o haz clic · JPG o PNG · Máx. 5 MB</div></div>
        <div class="field"><label>Reel / video de presentación (enlace de YouTube o Vimeo)</label><div class="inp-ic">${ic('link')}<input name="reel_url" placeholder="https://www.youtube.com/watch?v=..."></div></div>
        <div class="field"><label>Portafolio / sitio web <span class="muted">(opcional)</span></label><div class="inp-ic">${ic('language')}<input name="portafolio_url" placeholder="https://"></div></div>
        <div class="field"><label>Fotografías adicionales para tu book <span class="muted">(opcional, hasta 10)</span></label>
          <button type="button" class="btn outline-turq sm" id="add-fotos">${ic('add_photo_alternate')} Agregar fotos</button><input type="file" id="fotos" accept="image/*" multiple hidden>
          <div class="thumbs" id="thumbs"></div></div>
        <div class="field"><label>Redes profesionales <span class="muted">(opcional)</span></label><div id="redes"></div>
          <button type="button" class="link" id="add-red">${ic('add')} Agregar red social</button></div>
      </section>

      <section class="reg-step" data-s="5">
        <h2>5. Revisar y enviar</h2><p class="muted small">Verifica que toda la información esté correcta antes de enviar tu inscripción.</p>
        <div id="review"></div>
        <label class="check mt2"><input type="checkbox" name="autoriza_vitrina"> <span>Autorizo que mi perfil aprobado aparezca en la <b>vitrina pública</b> (solo mayores de edad; se muestra nombre artístico o primer nombre, nunca tus datos de contacto).</span></label>
      </section>
      </form>
    </div>`,
    foot: `<button class="btn outline" id="b-prev">${ic('chevron_left')} Atrás</button><button class="btn turq" id="b-next">Siguiente ${ic('chevron_right')}</button>`
  });
  const f = m.$('#reg');
  $$('[data-legal]', m.el).forEach(a => a.onclick = e => { e.preventDefault(); legal(a.dataset.legal); });

  // chips de selección múltiple
  m.$$('.opt').forEach(b => b.onclick = () => {
    b.classList.toggle('on');
    if (b.dataset.v === '__otro') m.$('#' + (b.dataset.g === 'areas' ? 'areas-otro' : 'esp-otro')).classList.toggle('hidden', !b.classList.contains('on'));
  });
  const sel = g => m.$$(`.opt.on[data-g="${g}"]`).map(b => b.dataset.v).filter(v => v !== '__otro')
    .concat(m.$(`.opt.on[data-g="${g}"][data-v="__otro"]`) ? [m.$('#' + (g === 'areas' ? 'areas-otro' : 'esp-otro')).value.trim()].filter(Boolean) : []);

  // menor de edad
  const edad = () => { const d = new Date(f.fecha_nacimiento.value); return isNaN(d) ? 99 : (Date.now() - d) / 31557600000; };
  f.fecha_nacimiento.onchange = () => m.$('#menor').classList.toggle('hidden', edad() >= 18);

  // experiencias
  const addExp = () => {
    st.expN++;
    m.$$('.exp-block').forEach(b => b.classList.add('closed'));
    m.$('#exps').insertAdjacentHTML('beforeend', `<div class="exp-block">
      <div class="hd"><span style="flex:1">Experiencia #<span class="n">${st.expN}</span></span><button type="button" class="link rm-exp" title="Quitar">${ic('delete_outline')}</button>${ic('expand_less')}</div>
      <div class="bd"><div class="field"><label>Producción / proyecto <span class="req">*</span></label><input data-k="proyecto" placeholder="Ej. La sombra del río"></div>
        <div class="field"><label>Tipo de producción <span class="req">*</span></label><select data-k="tipo">${PRODUCCIONES.map(x => `<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label>Personaje / rol <span class="req">*</span></label><input data-k="rol" placeholder="Ej. Personaje principal"></div>
        <div class="row2"><div class="field"><label>Año <span class="req">*</span></label><input data-k="anio" type="number" min="1950" max="${new Date().getFullYear()}" placeholder="Ej. 2022"></div>
          <div class="field"><label>Director / productora</label><input data-k="director" placeholder="Ej. Juan Pérez / Casa Productora"></div></div></div></div>`);
    const blk = m.$$('.exp-block').pop();
    blk.querySelector('.hd').onclick = e => { if (!e.target.closest('.rm-exp')) blk.classList.toggle('closed'); };
    blk.querySelector('.rm-exp').onclick = () => { blk.remove(); m.$$('.exp-block .n').forEach((n, i) => n.textContent = i + 1); st.expN = m.$$('.exp-block').length; if (!st.expN) f.tiene_exp.value = 'no'; syncExp(); };
  };
  const syncExp = () => {
    const si = f.querySelector('[name=tiene_exp]:checked').value === 'si';
    m.$('#add-exp').classList.toggle('hidden', !si); m.$('#exps').classList.toggle('hidden', !si);
    if (si && !m.$$('.exp-block').length) addExp();
  };
  m.$$('[name=tiene_exp]').forEach(r => r.onchange = syncExp);
  m.$('#add-exp').onclick = addExp;
  const exps = () => m.$$('.exp-block').map(b => Object.fromEntries([...b.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value.trim()])));

  // foto (arrastrar y soltar)
  const pd = m.$('#pdrop'), fi = m.$('#foto');
  const setFoto = async file => {
    if (!file || !file.type.startsWith('image/')) return toast('Selecciona una imagen JPG o PNG', 'err');
    st.foto = await comprimir(file);
    if (st.foto.size > 5.5e6) { st.foto = null; return toast('La imagen supera 5 MB', 'err'); }
    pd.style.backgroundImage = `url(${URL.createObjectURL(st.foto)})`; pd.classList.add('has');
  };
  pd.onclick = () => fi.click(); fi.onchange = () => setFoto(fi.files[0]);
  ['dragenter', 'dragover'].forEach(ev => pd.addEventListener(ev, e => { e.preventDefault(); pd.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => pd.addEventListener(ev, e => { e.preventDefault(); pd.classList.remove('over'); }));
  pd.addEventListener('drop', e => setFoto(e.dataTransfer.files[0]));

  // fotos adicionales
  const drawThumbs = () => {
    m.$('#thumbs').innerHTML = st.fotos.map((x, i) => `<div style="background-image:url(${URL.createObjectURL(x)})"><button type="button" data-i="${i}">×</button></div>`).join('');
    m.$$('#thumbs button').forEach(b => b.onclick = () => { st.fotos.splice(+b.dataset.i, 1); drawThumbs(); });
  };
  m.$('#add-fotos').onclick = () => m.$('#fotos').click();
  m.$('#fotos').onchange = async e => { for (const x of [...e.target.files].slice(0, 10 - st.fotos.length)) st.fotos.push(await comprimir(x)); e.target.value = ''; drawThumbs(); };

  // redes
  const addRed = (p = 'Instagram') => {
    m.$('#redes').insertAdjacentHTML('beforeend', `<div class="flex mb1 red-row"><select class="inp" style="max-width:160px">${REDES.map(x => `<option ${x === p ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <input class="inp" placeholder="@usuario o enlace"><button type="button" class="icon-btn" title="Quitar">${ic('delete_outline')}</button></div>`);
    const r = m.$$('.red-row').pop(); r.querySelector('button').onclick = () => r.remove();
  };
  addRed(); m.$('#add-red').onclick = () => addRed('TikTok');
  const redes = () => m.$$('.red-row').map(r => ({ plataforma: r.querySelector('select').value, url: r.querySelector('input').value.trim() })).filter(r => r.url);

  // revisión
  const review = () => {
    const card = (t, icn, paso, lines) => `<div class="rv"><div class="hd"><span class="i">${ic(icn)}</span><b>${t}</b><button type="button" class="link" data-go="${paso}">Editar</button></div>${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
    const ex = exps().filter(e => e.proyecto);
    m.$('#review').innerHTML =
      card('Datos personales', 'person_outline', 1, [`Nombre: <b>${esc(f.nombre_completo.value)}</b>`, `Documento: <b>${esc(f.numero_documento.value)}</b>`, `Correo: <b>${esc(f.correo.value)}</b>`, `Municipio: <b>${esc(f.municipio.value)}</b>`]) +
      card('Perfil artístico', 'star_outline', 2, [`Nombre artístico: <b>${esc(f.nombre_artistico.value || '—')}</b>`, `Áreas: <b>${esc(sel('areas').join(', '))}</b>`, `Especialidades: <b>${esc(sel('esp').join(', '))}</b>`]) +
      card('Experiencia profesional', 'work_outline', 3, [ex.length ? `<b>${ex.length}</b> proyecto(s) registrado(s)` : 'Sin experiencia profesional registrada']) +
      card('Material del actor', 'photo_camera', 4, [`Fotografía de perfil: <b>${st.foto ? 'cargada ✓' : 'falta'}</b>`, `Reel: <b>${f.reel_url.value ? 'enlace' : '—'}</b>`, `Fotos adicionales: <b>${st.fotos.length}</b>`, `Redes: <b>${redes().map(r => r.plataforma).join(', ') || '—'}</b>`]);
    m.$$('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  };

  // validación por paso
  const err = t => { m.$('#reg-err').innerHTML = t ? `<div class="err-msg">${ic('error_outline')} ${esc(t)}</div>` : ''; if (t) m.$('.modal-b').scrollTop = 0; return !t; };
  const validar = p => {
    if (p === 1) {
      for (const [k, t] of [['nombre_completo', 'el nombre completo'], ['numero_documento', 'el número de documento'], ['fecha_nacimiento', 'la fecha de nacimiento'], ['municipio', 'la ciudad o municipio'], ['correo', 'el correo'], ['telefono', 'el teléfono'], ['contrasena', 'la contraseña']])
        if (!f[k].value.trim()) { f[k].focus(); return err('Falta ' + t + '.'); }
      if (!/^\S+@\S+\.\S+$/.test(f.correo.value)) return err('Escribe un correo válido.');
      if (f.contrasena.value.length < 8 || !/[A-Za-z]/.test(f.contrasena.value) || !/\d/.test(f.contrasena.value)) return err('La contraseña debe tener al menos 8 caracteres, con letras y números.');
      if (f.contrasena.value !== f.contrasena2.value) return err('Las contraseñas no coinciden.');
      if (edad() < 18 && (!f.acudiente_nombre.value || !f.acudiente_documento.value || !f.acudiente_telefono.value || !f.acudiente_correo.value || !f.autorizacion.files[0])) return err('Completa los datos del acudiente legal, su correo y adjunta la autorización firmada.');
      if (!f.acepta_terminos.checked) return err('Debes aceptar el tratamiento de datos personales.');
    }
    if (p === 2) {
      if (!sel('areas').length) return err('Selecciona al menos un área.');
      if (!sel('esp').length) return err('Selecciona al menos una especialidad.');
    }
    if (p === 3 && f.querySelector('[name=tiene_exp]:checked').value === 'si') {
      const e = exps();
      if (!e.length || e.some(x => !x.proyecto || !x.rol || !x.anio)) return err('Completa proyecto, personaje y año de cada experiencia (o marca "No").');
    }
    if (p === 2) {
      const a = f.edad_aparente_min.value, b = f.edad_aparente_max.value;
      if ((a === '') !== (b === '')) return err('Indica la edad aparente mínima y máxima, o deja ambas vacías.');
      if (a !== '' && +a > +b) return err('La edad aparente mínima no puede superar la máxima.');
    }
    if (p === 4 && !st.foto) return err('Sube tu fotografía de perfil.');
    return err('');
  };
  const go = p => {
    st.paso = p;
    m.$$('.reg-step').forEach(s => s.classList.toggle('on', +s.dataset.s === p));
    m.$$('.stepper .st').forEach(s => { const n = +s.dataset.s; s.classList.toggle('done', n < p); s.classList.toggle('cur', n === p); });
    m.$('#b-prev').style.visibility = p > 1 ? 'visible' : 'hidden';
    m.$('#b-next').innerHTML = p === 5 ? `${ic('send')} Enviar inscripción` : `Siguiente ${ic('chevron_right')}`;
    if (p === 5) review();
    m.$('.modal-b').scrollTop = 0;
  };
  m.$('#b-prev').onclick = () => go(Math.max(1, st.paso - 1));
  m.$('#b-next').onclick = async () => {
    if (st.paso < 5) { if (validar(st.paso)) go(st.paso + 1); return; }
    for (let p = 1; p <= 4; p++) if (!validar(p)) return go(p), validar(p);
    const fd = new FormData();
    for (const k of ['nombre_completo', 'tipo_documento', 'numero_documento', 'fecha_nacimiento', 'municipio', 'correo', 'telefono', 'contrasena', 'nombre_artistico',
      'genero', 'estatura_cm', 'tono_piel', 'dialecto', 'color_ojos', 'color_cabello', 'provincia', 'edad_aparente_min', 'edad_aparente_max', 'nivel', 'ocupacion', 'biografia', 'reel_url', 'portafolio_url', 'acudiente_nombre', 'acudiente_documento', 'acudiente_telefono', 'acudiente_correo'])
      fd.append(k, (f[k].value || '').trim());
    fd.append('acepta_terminos', 'true'); fd.append('autoriza_vitrina_publica', f.autoriza_vitrina.checked ? 'true' : 'false');
    fd.append('areas', JSON.stringify(sel('areas'))); fd.append('especialidades', JSON.stringify(sel('esp')));
    fd.append('experiencias', JSON.stringify(f.querySelector('[name=tiene_exp]:checked').value === 'si' ? exps() : []));
    fd.append('redes', JSON.stringify(redes()));
    fd.append('foto', st.foto);
    st.fotos.forEach(x => fd.append('fotos', x));
    if (f.autorizacion.files[0]) fd.append('autorizacion', f.autorizacion.files[0]);
    const b = m.$('#b-next'); b.disabled = true; b.innerHTML = 'Enviando...';
    try {
      const r = await api('/api/registro', { method: 'POST', body: fd });
      login(r);
      m.$('.reg-head').remove(); m.$('.modal-f').remove();
      m.$('.reg-body').innerHTML = `<div class="success">
        <button class="x icon-btn" style="border:0;position:absolute;right:18px;top:16px" aria-label="Cerrar">${ic('close')}</button>
        <div class="big-ok">${ic('check')}</div><h1 style="font-size:1.9rem">¡Solicitud enviada con éxito!</h1>
        <p class="muted">Hemos recibido tu postulación. Nuestro equipo revisará tu perfil y material con detenimiento.</p>
        <div class="grid g2 mt2" style="text-align:left">
          <div class="card-lime"><div class="flex"><span class="tile" style="width:44px;height:44px;border-radius:50%;background:var(--petrol);color:var(--lime)">${ic('schedule')}</span>
            <div><small>Plazo de respuesta</small><h2 class="mb0">Máximo 15 días</h2></div></div>
            <p class="small mt1 mb0">Te notificaremos el resultado por correo electrónico y dentro de la plataforma.</p></div>
          <div class="card-petrol"><h3 style="color:var(--lime)">¿Qué sigue?</h3>
            <p class="small mb1">① Revisión de tu perfil y material.</p><p class="small mb1">② Evaluación por parte del equipo del Centro Actoral.</p><p class="small mb1">③ Notificación de la respuesta en un plazo máximo de 15 días.</p>
            <p class="small mb0" style="border-top:1.5px solid var(--turq);padding-top:10px">N.º de solicitud: <b style="color:var(--lime)">${esc(r.numero)}</b></p></div>
        </div>
        <div class="ok-msg mt2" style="text-align:left">${ic('mark_email_read')} Te enviamos un correo a <b>${esc(f.correo.value)}</b> para verificar tu cuenta. Revisa también la carpeta de spam.</div>
        <a class="btn turq block big mt3" href="postulaciones.html">Ver mi solicitud</a></div>`;
      m.$('.success .x').onclick = () => location.href = 'postulaciones.html';
    } catch (e) { b.disabled = false; b.innerHTML = `${ic('send')} Enviar inscripción`; err(e.message); }
  };
  go(1);
}
