/**
 * Listas controladas. Para agregar/quitar una opción edita SOLO este archivo
 * (no hay que tocar la base de datos: se validan en la API).
 */
export interface Opcion {
  codigo: string;
  etiqueta: string;
}
export const codigos = (lista: readonly Opcion[]) => lista.map((o) => o.codigo);

export const GENEROS: Opcion[] = [
  { codigo: 'FEMENINO', etiqueta: 'Femenino' },
  { codigo: 'MASCULINO', etiqueta: 'Masculino' },
  { codigo: 'NO_BINARIO', etiqueta: 'No binario' },
  { codigo: 'PREFIERE_NO_DECIR', etiqueta: 'Prefiere no decir' },
];

export const TONOS_PIEL: Opcion[] = [
  { codigo: 'MUY_CLARA', etiqueta: 'Muy clara' },
  { codigo: 'CLARA', etiqueta: 'Clara' },
  { codigo: 'TRIGUENA', etiqueta: 'Trigueña' },
  { codigo: 'MORENA', etiqueta: 'Morena' },
  { codigo: 'OSCURA', etiqueta: 'Oscura' },
];

export const COLORES_OJOS: Opcion[] = [
  { codigo: 'NEGROS', etiqueta: 'Negros' },
  { codigo: 'CAFES', etiqueta: 'Cafés' },
  { codigo: 'AVELLANA', etiqueta: 'Avellana' },
  { codigo: 'VERDES', etiqueta: 'Verdes' },
  { codigo: 'AZULES', etiqueta: 'Azules' },
  { codigo: 'GRISES', etiqueta: 'Grises' },
];

export const COLORES_CABELLO: Opcion[] = [
  { codigo: 'NEGRO', etiqueta: 'Negro' },
  { codigo: 'CASTANO', etiqueta: 'Castaño' },
  { codigo: 'RUBIO', etiqueta: 'Rubio' },
  { codigo: 'PELIRROJO', etiqueta: 'Pelirrojo' },
  { codigo: 'CANOSO', etiqueta: 'Canoso' },
  { codigo: 'SIN_CABELLO', etiqueta: 'Sin cabello' },
];

export const DIALECTOS: Opcion[] = [
  { codigo: 'NEUTRO', etiqueta: 'Neutro' },
  { codigo: 'BOYACENSE', etiqueta: 'Boyacense' },
  { codigo: 'CACHACO', etiqueta: 'Cachaco (Bogotá)' },
  { codigo: 'PAISA', etiqueta: 'Paisa' },
  { codigo: 'COSTENO', etiqueta: 'Costeño (Caribe)' },
  { codigo: 'VALLUNO', etiqueta: 'Valluno' },
  { codigo: 'SANTANDEREANO', etiqueta: 'Santandereano' },
  { codigo: 'LLANERO', etiqueta: 'Llanero' },
  { codigo: 'PACIFICO', etiqueta: 'Pacífico' },
  { codigo: 'PASTUSO', etiqueta: 'Pastuso' },
];

export const PROVINCIAS: Opcion[] = [
  { codigo: 'CENTRO', etiqueta: 'Centro' },
  { codigo: 'GUTIERREZ', etiqueta: 'Gutiérrez' },
  { codigo: 'LA_LIBERTAD', etiqueta: 'La Libertad' },
  { codigo: 'LENGUPA', etiqueta: 'Lengupá' },
  { codigo: 'MARQUEZ', etiqueta: 'Márquez' },
  { codigo: 'NEIRA', etiqueta: 'Neira' },
  { codigo: 'NORTE', etiqueta: 'Norte' },
  { codigo: 'OCCIDENTE', etiqueta: 'Occidente' },
  { codigo: 'ORIENTE', etiqueta: 'Oriente' },
  { codigo: 'RICAURTE', etiqueta: 'Ricaurte' },
  { codigo: 'SUGAMUXI', etiqueta: 'Sugamuxi' },
  { codigo: 'TUNDAMA', etiqueta: 'Tundama' },
  { codigo: 'VALDERRAMA', etiqueta: 'Valderrama' },
  { codigo: 'FUERA_DE_BOYACA', etiqueta: 'Fuera de Boyacá' },
];

export const MODALIDADES: Opcion[] = [
  { codigo: 'PRESENCIAL', etiqueta: 'Presencial' },
  { codigo: 'VIRTUAL', etiqueta: 'Virtual' },
  { codigo: 'HIBRIDA', etiqueta: 'Híbrida' },
];
