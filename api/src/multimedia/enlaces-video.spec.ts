import { analizarEnlaceVideo } from './enlaces-video';

describe('analizarEnlaceVideo', () => {
  const ID = 'dQw4w9WgXcQ';

  it('acepta las formas habituales de YouTube y las normaliza', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}&t=10s`,
      `https://youtu.be/${ID}?si=abc`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
    ]) {
      const r = analizarEnlaceVideo(url);
      expect(r?.proveedor).toBe('YOUTUBE');
      expect(r?.id_video).toBe(ID);
      expect(r?.url_canonica).toBe(`https://www.youtube.com/watch?v=${ID}`);
    }
  });

  it('acepta Vimeo (público, no listado y player)', () => {
    expect(analizarEnlaceVideo('https://vimeo.com/123456789')?.url_canonica).toBe('https://vimeo.com/123456789');
    expect(analizarEnlaceVideo('https://vimeo.com/123456789/abcdef1234')?.url_embed).toBe(
      'https://player.vimeo.com/video/123456789?h=abcdef1234',
    );
    expect(analizarEnlaceVideo('https://player.vimeo.com/video/123456789')?.id_video).toBe('123456789');
  });

  it('es idempotente: la URL canónica se vuelve a analizar igual', () => {
    const a = analizarEnlaceVideo(`https://youtu.be/${ID}`)!;
    expect(analizarEnlaceVideo(a.url_canonica)).toEqual(a);
  });

  it('rechaza http, otros hosts, dominios engañosos, credenciales e IDs inválidos', () => {
    for (const url of [
      `http://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com.evil.com/watch?v=${ID}`,
      `https://evil.com/?u=youtube.com/watch?v=${ID}`,
      `https://user:pass@www.youtube.com/watch?v=${ID}`,
      'https://www.youtube.com/watch?v=corto',
      'https://www.youtube.com/channel/UC123',
      'https://vimeo.com/channels/staffpicks/123456789',
      'https://vimeo.com/abc',
      'javascript:alert(1)',
      'no es una url',
      '',
    ]) {
      expect(analizarEnlaceVideo(url)).toBeNull();
    }
  });
});
