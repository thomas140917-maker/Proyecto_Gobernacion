/* Utilidades del panel de administración */
const ENTIDAD = { perfiles_actores: 'Perfil', actores: 'Perfil', cursos_y_talleres: 'Curso', convocatorias: 'Convocatoria', noticias: 'Noticia', postulaciones_castings: 'Postulación', inscripciones_cursos: 'Inscripción', inscripciones_curso: 'Inscripción', reportes_perfil: 'Reporte', acudientes_legales: 'Acudiente', archivos_multimedia: 'Multimedia' };
const ENT_ICON = { perfiles_actores: 'person', actores: 'person', cursos_y_talleres: 'school', convocatorias: 'campaign', noticias: 'article', postulaciones_castings: 'assignment_ind', inscripciones_cursos: 'how_to_reg', inscripciones_curso: 'how_to_reg', reportes_perfil: 'flag', acudientes_legales: 'family_restroom', archivos_multimedia: 'image' };
function movIcon(m) {
  if (m.tipo_accion === 'ELIMINAR') return 'delete_outline';
  if (/foto/i.test(m.observacion_accion || '')) return 'image';
  if (/descripci|biograf/i.test(m.observacion_accion || '')) return 'description';
  if ((m.tipo_accion === 'ACTUALIZAR' || m.tipo_accion === 'ACCION_ADMINISTRADOR') && m.rol === 'Administrador') return 'edit';
  return ENT_ICON[m.entidad_afectada] || 'bolt';
}
function feedItem(m) {
  return `<div class="it"><span class="ic">${ic(movIcon(m))}</span>
    <div class="t"><b>${esc(m.observacion_accion || m.tipo_accion)}</b><small>${esc(m.quien)}</small></div>
    <div class="w"><b>${esc(m.quien)}</b>${esc(m.rol)}<br>${hace(m.creado_en)}<br><span class="chip ${m.rol === 'Administrador' ? 'outline' : 'lime'}" style="font-size:.66rem;padding:2px 8px;margin-top:4px">${ENTIDAD[m.entidad_afectada] || m.entidad_afectada}</span></div></div>`;
}

// Ficha completa del actor (para revisar antes de aprobar)
async function verPerfilAdmin(id, onChange) {
  const d = drawer(`<div class="spinner"></div>`);
  let a;
  try { await catalogos(); a = await api('/api/admin/perfiles/' + id); } catch (e) { d.el.querySelector('.drawer').innerHTML = `<div class="err-msg" style="margin:20px">${esc(e.message)}</div>`; return; }
  const ETIQ_CAMPO = { nombre_artistico: 'Nombre artístico', tiene_experiencia: 'Tiene experiencia', biografia: 'Biografía', estatura_cm: 'Estatura (cm)', color_ojos: 'Color de ojos', color_cabello: 'Color de cabello', tono_piel: 'Tono de piel', contextura: 'Contextura', genero: 'Género', edad_aparente_min: 'Edad aparente (mín.)', edad_aparente_max: 'Edad aparente (máx.)', dialecto: 'Dialecto', provincia: 'Provincia', foto_perfil_url: 'Foto de perfil' };
  const CAT_DE = { genero: 'generos', tono_piel: 'tonos_piel', color_ojos: 'colores_ojos', color_cabello: 'colores_cabello', dialecto: 'dialectos', provincia: 'provincias' };
  const valCampo = (campo, v) => v == null || v === '' ? '' : CAT_DE[campo] ? etq(CAT_DE[campo], v) : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v);
  const docs = { CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PASAPORTE: 'Pasaporte', NIT: 'NIT' };
  const row = (k, v) => v ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '';
  const est = { PENDIENTE: ['Pendiente', 'turq'], APROBADO: ['Aprobado', 'lime'], RECHAZADO: ['Rechazado', 'red'] }[a.estado];
  d.el.querySelector('.drawer').innerHTML = `
    <div style="background:var(--petrol);color:#fff;padding:22px 26px;display:flex;gap:18px;align-items:center;position:sticky;top:0;z-index:2">
      <div class="av" style="width:76px;height:76px;${bg(a.foto)}">${a.foto ? '' : ic('person')}</div>
      <div style="flex:1;min-width:0"><h2 style="color:#fff;margin:0">${esc(a.nombre)}</h2><div class="small" style="opacity:.85">${esc(a.nombre_completo)} · ${esc(rolLabel(a))} · ${esc(a.ciudad || '')}</div>
        <div class="flex mt1"><span class="chip ${est[1]}">${est[0]}</span>${a.restringido ? '<span class="chip red">Restringido</span>' : ''}<span class="small" style="opacity:.8">Solicitud CIN-${new Date(a.creado_en).getFullYear()}-${String(a.numero_solicitud || 0).padStart(4, '0')}</span></div></div>
      <button class="icon-btn light" data-close aria-label="Cerrar">${ic('close')}</button></div>
    <div style="padding:22px 26px 30px">
      ${a.estado === 'RECHAZADO' && a.motivo_rechazo ? `<div class="err-msg">Motivo del rechazo: ${esc(a.motivo_rechazo)}</div>` : ''}
      ${a.restringido ? `<div class="err-msg">Restringido: ${esc(a.motivo_restriccion || '')}</div>` : ''}
      <h3>Datos personales</h3><table class="dl">
        ${row('Documento', (docs[a.tipo_documento] || a.tipo_documento) + ' ' + a.numero_documento)}${row('Fecha de nacimiento', fecha(a.fecha_nacimiento, true) + ` (${a.edad} años)`)}
        ${row('Municipio', a.municipio)}${row('Correo', a.correo)}${row('Teléfono', a.telefono)}${row('Género', etq('generos', a.genero))}${row('Estatura', a.estatura_cm ? a.estatura_cm + ' cm' : '')}${row('Edad aparente', edadAparente(a))}
        ${row('Tono de piel', etq('tonos_piel', a.tono_piel))}${row('Ojos', etq('colores_ojos', a.color_ojos))}${row('Cabello', etq('colores_cabello', a.color_cabello))}${row('Dialecto', etq('dialectos', a.dialecto))}${row('Provincia', etq('provincias', a.provincia))}${row('Nivel', a.nivel)}
        ${row('Vitrina pública', a.autoriza_vitrina_publica ? 'Autorizada' : 'No autorizada')}</table>
      ${a.acudiente ? `<h3 class="mt2">Acudiente legal (menor de edad) ${a.acudiente.esta_verificado ? '<span class="chip lime" style="font-size:.7rem">Verificado</span>' : '<span class="chip red" style="font-size:.7rem">Sin verificar</span>'}</h3><table class="dl">${row('Nombre', a.acudiente.nombre_acudiente)}${row('Documento', a.acudiente.documento_acudiente)}${row('Teléfono', a.acudiente.telefono_acudiente)}${row('Correo', a.acudiente.correo_acudiente)}</table>
        <div class="flex wrap mt1">${a.acudiente.url_documento_autorizacion ? `<button class="btn soft sm" id="ver-aut">${ic('description')} Ver autorización firmada</button>` : '<span class="small muted">Autorización firmada: no adjuntada.</span>'}
        ${a.acudiente.esta_verificado ? '' : `<button class="btn lime sm" id="ver-acu">${ic('verified_user')} Marcar acudiente como verificado</button>`}</div>
        <p class="small muted">Un menor no puede aprobarse sin acudiente verificado. Cada consulta del documento queda registrada en el historial.</p>` : ''}
      ${a.version_pendiente ? `<h3 class="mt2">${a.version_pendiente.es_primera_version ? 'Primer envío a revisión' : 'Cambios pendientes de aprobación'} <span class="chip turq" style="font-size:.7rem">v${a.version_pendiente.numero_version}</span></h3>
        ${a.version_pendiente.foto_nueva ? `<div class="flex mb1" style="gap:14px"><div><small class="muted">Actual</small><div class="ph" style="width:96px;height:120px;border-radius:12px;background:#eee center/cover;${bg(a.version_pendiente.foto_actual)}"></div></div><div><small class="muted">Nueva</small><div class="ph" data-src="${esc(a.version_pendiente.foto_nueva)}" style="width:96px;height:120px;border-radius:12px;background:#eee center/cover;${bg(a.version_pendiente.foto_nueva)}"></div></div></div>` : ''}
        ${a.version_pendiente.campos.filter(c => c.cambiado).length ? `<table class="dl">${a.version_pendiente.campos.filter(c => c.cambiado).map(c => `<tr><td>${esc(ETIQ_CAMPO[c.campo] || c.campo)}</td><td><s class="muted">${esc(valCampo(c.campo, c.publicado) || '—')}</s> → <b>${esc(valCampo(c.campo, c.borrador) || '—')}</b></td></tr>`).join('')}</table>` : '<p class="small muted">Sin cambios en campos de texto.</p>'}` : ''}
      <h3 class="mt2">Perfil artístico</h3>
      <div class="flex wrap mb1">${[...a.areas, ...a.especialidades].map(x => `<span class="chip turq">${esc(x)}</span>`).join('') || '<span class="muted small">Sin áreas</span>'}</div>
      <p>${esc(a.biografia || 'Sin biografía.')}</p>
      ${a.experiencias.length ? `<h3 class="mt2">Experiencia</h3>${a.experiencias.map(e => `<div class="exp-item"><div><b>${esc(e.nombre_proyecto)}</b><small>${esc(e.tipo_produccion)} · ${esc(e.rol_desempenado)}${e.director_o_productora ? ' · Dir. ' + esc(e.director_o_productora) : ''}</small></div><span class="muted">${e.anio}</span></div>`).join('')}` : ''}
      <h3 class="mt2">Material</h3>
      <div class="gal" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${[[a.foto_grande || a.foto, a.foto], ...a.fotos.map(f => [f.url, f.miniatura])].filter(x => x[0]).map(([u, t]) => `<div class="ph" data-src="${esc(u)}" style="${bg(t || u)}"></div>`).join('') || '<p class="muted small">Sin fotografías.</p>'}</div>
      ${a.videos.map(v => `<div class="mt2">${embedVideo(v)}</div>`).join('')}
      ${a.enlaces.map(e => `<p class="mt1"><a class="link" target="_blank" rel="noopener" href="${esc(e.url)}">${ic('language')} ${esc(e.titulo || 'Portafolio')}</a></p>`).join('')}
      ${a.redes.length ? `<div class="flex wrap mt1">${a.redes.map(r => `<span class="chip outline">${esc(r.plataforma)}: ${esc(r.url_perfil)}</span>`).join('')}</div>` : ''}
      <div class="flex wrap mt3" id="acts"></div>
    </div>`;
  $$('.gal .ph', d.el).forEach(p => p.onclick = () => lightbox(p.dataset.src));
  $$('[data-close]', d.el).forEach(b => b.onclick = d.close);
  const acts = $('#acts', d.el);
  const done = msg => { toast(msg); d.close(); onChange && onChange(); };
  const vid = a.version_pendiente && a.version_pendiente.version_id;
  const verAut = $('#ver-aut', d.el), verAcu = $('#ver-acu', d.el);
  if (verAut) verAut.onclick = () => abrirDocumento(id);
  if (verAcu) verAcu.onclick = async () => { try { await api('/api/admin/acudientes/' + id + '/verificar', { method: 'PUT' }); toast('Acudiente verificado'); d.close(); verPerfilAdmin(id, onChange); onChange && onChange(); } catch (e) { toast(e.message, 'err'); } };
  const aprobar = async () => { try { await api('/api/admin/solicitudes/' + id, { method: 'PUT', body: { estado: 'APROBADO', version_id: vid } }); done('Perfil aprobado'); } catch (e) { toast(e.message, 'err'); } };
  const rechazarVer = async () => { const r = await rechazar(); if (!r) return; try { await api('/api/admin/solicitudes/' + id, { method: 'PUT', body: { estado: 'RECHAZADO', motivo: r.value, version_id: vid } }); done('Cambios rechazados'); } catch (e) { toast(e.message, 'err'); } };
  if (a.version_pendiente) {
    acts.innerHTML = `<button class="btn lime" data-a="ok">${ic('check')} ${a.version_pendiente.es_primera_version ? 'Aprobar perfil' : 'Aprobar cambios'}</button><button class="btn outline" data-a="no">${ic('close')} Rechazar</button>`;
    $('[data-a=ok]', acts).onclick = aprobar; $('[data-a=no]', acts).onclick = rechazarVer;
  } else if (a.estado === 'RECHAZADO') {
    acts.innerHTML = `<p class="small muted" style="flex:1">El actor debe corregir su perfil y volver a enviarlo; aparecerá de nuevo en pendientes.</p>`;
  } else {
    acts.innerHTML = `<a class="btn outline" target="_blank" href="perfil.html?id=${id}">${ic('visibility')} Ver perfil público</a>` +
      (a.restringido ? `<button class="btn soft" data-a="un">${ic('lock_open')} Quitar restricción</button>` : `<button class="btn danger" data-a="lock">${ic('lock')} Aplicar restricción</button>`);
    const lock = $('[data-a=lock]', acts), un = $('[data-a=un]', acts);
    if (lock) lock.onclick = async () => { const r = await confirmBox({ title: '¿Restringir este perfil?', text: 'El perfil dejará de mostrarse en la vitrina pública.', ok: 'Aplicar restricción', danger: true, icon: 'lock', input: { label: 'Motivo de la restricción', placeholder: 'Ej. Contenido no apropiado' } }); if (r) { await api('/api/admin/restriccion/' + id, { method: 'PUT', body: { restringido: true, motivo: r.value } }); done('Restricción aplicada'); } };
    if (un) un.onclick = async () => { await api('/api/admin/restriccion/' + id, { method: 'PUT', body: { restringido: false } }); done('Restricción eliminada'); };
  }
}
const rechazar = () => confirmBox({ title: '¿Rechazar este perfil?', text: 'Esta solicitud pasará a la lista de perfiles rechazados.', ok: 'Rechazar', icon: 'close', input: { label: 'Motivo del rechazo (mínimo 20 caracteres, lo verá el actor)', placeholder: 'Explica qué debe corregir', optional: false } });

// Selector de archivo de imagen con vista previa (formularios de contenido)
function imagePicker(box, url) {
  box.innerHTML = `<div class="dropzone" style="padding:18px;${url ? `background:url('${esc(url)}') center/cover;min-height:160px` : ''}">
    <div class="in" style="${url ? 'background:rgba(255,255,255,.85);border-radius:12px;padding:8px;display:inline-block' : ''}">${ic('image')}<b>Toca para subir una imagen</b><div class="small">JPG, PNG · Máx. 5 MB</div></div></div><input type="file" accept="image/*" hidden>`;
  const dz = $('.dropzone', box), inp = $('input', box);
  let file = null;
  const set = async f => { if (!f || !f.type.startsWith('image/')) return; file = await comprimir(f); dz.style.background = `url(${URL.createObjectURL(file)}) center/cover`; dz.style.minHeight = '160px'; $('.in', dz).style.cssText = 'background:rgba(255,255,255,.85);border-radius:12px;padding:8px;display:inline-block'; };
  dz.onclick = () => inp.click(); inp.onchange = () => set(inp.files[0]);
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => set(e.dataTransfer.files[0]));
  return () => file;
}

// Documento de autorización del acudiente: nunca es público; se pide con el token de administrador y se muestra como blob
async function abrirDocumento(actorId) {
  try {
    const r = await fetch('/api/admin/acudientes/' + actorId + '/documento', { headers: { Authorization: 'Bearer ' + S.token } });
    if (!r.ok) { let m = 'No se pudo abrir el documento'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message, 'err'); }
}
