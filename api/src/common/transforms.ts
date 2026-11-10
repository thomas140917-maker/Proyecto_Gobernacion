import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';

/** Quita caracteres de control (conserva \n, \r y \t) y recorta espacios. */
const limpiar = (v: unknown) =>
  typeof v === 'string'
    ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
    : v;

export const Trim = () => Transform(({ value }) => limpiar(value));

/** Opcional: en multipart '' significa "no enviado". */
export const Opt = () =>
  applyDecorators(
    Transform(({ value }) => {
      const v = limpiar(value);
      return v === '' ? undefined : v;
    }),
    IsOptional(),
  );

export const Correo = () =>
  Transform(({ value }) => {
    const v = limpiar(value);
    return typeof v === 'string' ? v.toLowerCase() : v;
  });

/** Normaliza documentos: sin espacios, puntos ni guiones, en mayúsculas ("1.052.000-1" => "10520001"). */
export const Documento = () =>
  Transform(({ value }) => {
    const v = limpiar(value);
    return typeof v === 'string' ? v.replace(/[\s.\-]/g, '').toUpperCase() : v;
  });

export const Bool = () => Transform(({ value }) => value === true || value === 'true');

/** Número entero opcional (sirve para multipart —llega como texto— y para JSON). */
export const Entero = () =>
  Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)));
