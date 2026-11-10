import { CAMPOS_PERFIL, CampoPerfil, DatosPerfil } from '../common/campos-perfil';

export interface CampoDiff {
  campo: CampoPerfil;
  publicado: unknown;
  borrador: unknown;
  cambiado: boolean;
}

const norm = (v: unknown) => (v === undefined || v === '' ? null : v);

/** Compara campo a campo la versión pública (o null si aún no hay) contra el borrador. */
export function compararPerfil(
  publicado: Partial<DatosPerfil> | null,
  borrador: Partial<DatosPerfil>,
): { campos: CampoDiff[]; total_cambios: number } {
  const campos = CAMPOS_PERFIL.map((campo) => {
    const a = norm(publicado?.[campo]);
    const b = norm(borrador?.[campo]);
    return { campo, publicado: a, borrador: b, cambiado: a !== b };
  });
  return { campos, total_cambios: campos.filter((c) => c.cambiado).length };
}
