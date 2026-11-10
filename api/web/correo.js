// Envío de correos (mismas variables SMTP_* y MAIL_FROM que el backend). Si no hay SMTP_HOST o nodemailer,
// el mensaje se escribe en el log (útil en desarrollo). Un fallo de correo nunca tumba la petición.
const e = process.env;
let _t;
function transporte() {
  if (_t !== undefined) return _t;
  _t = null;
  if (!e.SMTP_HOST) return _t;
  try {
    const nodemailer = require('nodemailer');
    _t = nodemailer.createTransport({
      host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 1025), secure: e.SMTP_SECURE === 'true',
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    });
  } catch { console.warn('[correo] nodemailer no está instalado: los correos se escriben en el log'); }
  return _t;
}
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => String(e.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

function plantilla(titulo, parrafos, boton, enlace, pie) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222">
  <h2 style="color:#0E5B69">${escapar(titulo)}</h2>${parrafos.map((p) => `<p>${p}</p>`).join('')}
  <p style="margin:26px 0"><a href="${escapar(enlace)}" style="background:#B9F53D;color:#0E5B69;padding:13px 22px;border-radius:26px;text-decoration:none;font-weight:bold">${escapar(boton)}</a></p>
  <p style="font-size:12px;color:#666">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapar(enlace)}</p>
  <p style="font-size:12px;color:#666">${pie}</p><p style="font-size:12px;color:#999">Centro Actoral de Boyacá</p></div>`;
}

async function enviar(para, asunto, texto, html) {
  const t = transporte();
  if (!t) { console.log(`[correo] (sin SMTP) Para: ${para} | ${asunto}\n${texto}`); return false; }
  try {
    await t.sendMail({ from: e.MAIL_FROM || 'no-reply@centroactoral.com', to: para, subject: asunto, text: texto, html });
    return true;
  } catch (err) { console.error('[correo] no se pudo enviar a', para, err.message); return false; }
}

const enviarVerificacion = (para, nombre, token) => {
  const enlace = `${base()}/verificar.html#token=${token}`;
  return enviar(para, 'Verifica tu correo - Centro Actoral de Boyacá',
    `Hola ${nombre},\n\nGracias por registrarte. Confirma tu correo con este enlace (válido por 48 horas):\n${enlace}\n\nSi no fuiste tú, ignora este mensaje.`,
    plantilla(`¡Hola, ${nombre}!`, ['Gracias por registrarte en el Centro Actoral de Boyacá. Confirma tu correo electrónico para completar tu cuenta (el enlace vale 48 horas).'],
      'Verificar mi correo', enlace, 'Si no creaste esta cuenta, ignora este mensaje.'));
};
const enviarRecuperacion = (para, nombre, token) => {
  const enlace = `${base()}/restablecer.html#token=${token}`;
  return enviar(para, 'Recupera tu contraseña - Centro Actoral de Boyacá',
    `Hola ${nombre},\n\nRecibimos una solicitud para crear una nueva contraseña. Usa este enlace (válido por 30 minutos, un solo uso):\n${enlace}\n\nSi no fuiste tú, ignora este mensaje; tu contraseña no cambiará.`,
    plantilla(`Hola, ${nombre}`, ['Recibimos una solicitud para crear una nueva contraseña. El enlace vale <b>30 minutos</b> y solo puede usarse una vez.'],
      'Crear nueva contraseña', enlace, 'Si no fuiste tú, ignora este mensaje: tu contraseña actual no cambia.'));
};
const enviarClaveCambiada = (para, nombre) => enviar(para, 'Tu contraseña fue cambiada - Centro Actoral de Boyacá',
  `Hola ${nombre},\n\nTu contraseña acaba de cambiar. Si no fuiste tú, solicita un restablecimiento de inmediato o comunícate con el Centro Actoral.`,
  `<p>Hola ${escapar(nombre)},</p><p>Tu contraseña acaba de cambiar. Si no fuiste tú, solicita un restablecimiento de inmediato o comunícate con el Centro Actoral.</p>`);

module.exports = { enviarVerificacion, enviarRecuperacion, enviarClaveCambiada };
