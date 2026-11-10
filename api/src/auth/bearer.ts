import { UnauthorizedException } from '@nestjs/common';

export interface UsuarioSesion {
  tipo: 'ADMIN' | 'ACTOR';
  id: string;
}

export function extraerBearer(req: { headers: Record<string, any> }): string {
  const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) throw new UnauthorizedException();
  return token;
}
