import { BadRequestException } from '@nestjs/common';

export type ProveedorVideo = 'YOUTUBE' | 'VIMEO';

export interface EnlaceVideo {
  proveedor: ProveedorVideo;
  id_video: string;
  url_canonica: string;
  url_embed: string;
}

const HOSTS_YOUTUBE = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const HOSTS_VIMEO = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;
const ID_VIMEO = /^\d{5,12}$/;
const HASH_VIMEO = /^[A-Za-z0-9]{6,20}$/;

/**
 * Valida y normaliza enlaces de YouTube/Vimeo. Solo https, host exacto de la lista
 * (no sirve "youtube.com.evil.com"), sin credenciales y con ID de video bien formado.
 * Devuelve null si no es válido.
 */
export function analizarEnlaceVideo(entrada: string): EnlaceVideo | null {
  if (typeof entrada !== 'string' || entrada.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(entrada.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;

  const host = u.hostname.toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);

  if (HOSTS_YOUTUBE.has(host)) {
    let id: string | undefined;
    if (host.endsWith('youtu.be')) id = partes[0];
    else if (partes[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
    else if (['embed', 'shorts', 'live'].includes(partes[0])) id = partes[1];
    if (!id || !ID_YOUTUBE.test(id)) return null;
    return {
      proveedor: 'YOUTUBE',
      id_video: id,
      url_canonica: `https://www.youtube.com/watch?v=${id}`,
      url_embed: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  }

  if (HOSTS_VIMEO.has(host)) {
    let id: string | undefined;
    let hash: string | undefined;
    if (host === 'player.vimeo.com') {
      if (partes[0] !== 'video') return null;
      id = partes[1];
      hash = u.searchParams.get('h') ?? undefined;
    } else {
      id = partes[0];
      hash = partes[1];
    }
    if (!id || !ID_VIMEO.test(id)) return null;
    if (hash !== undefined && !HASH_VIMEO.test(hash)) return null;
    return {
      proveedor: 'VIMEO',
      id_video: id,
      url_canonica: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
      url_embed: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`,
    };
  }
  return null;
}

export function exigirEnlaceVideo(entrada: string): EnlaceVideo {
  const enlace = analizarEnlaceVideo(entrada);
  if (!enlace) {
    throw new BadRequestException(
      'El enlace debe ser una URL https de YouTube o Vimeo que apunte a un video válido',
    );
  }
  return enlace;
}
