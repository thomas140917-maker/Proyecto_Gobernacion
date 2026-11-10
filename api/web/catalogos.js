// Listas controladas. DEBEN coincidir con api/src/common/catalogos.ts (el backend las valida con esos códigos).
const op = (codigo, etiqueta) => ({ codigo, etiqueta });

const GENEROS = [op('FEMENINO', 'Femenino'), op('MASCULINO', 'Masculino'), op('NO_BINARIO', 'No binario'), op('PREFIERE_NO_DECIR', 'Prefiere no decir')];
const TONOS_PIEL = [op('MUY_CLARA', 'Muy clara'), op('CLARA', 'Clara'), op('TRIGUENA', 'Trigueña'), op('MORENA', 'Morena'), op('OSCURA', 'Oscura')];
const COLORES_OJOS = [op('NEGROS', 'Negros'), op('CAFES', 'Cafés'), op('AVELLANA', 'Avellana'), op('VERDES', 'Verdes'), op('AZULES', 'Azules'), op('GRISES', 'Grises')];
const COLORES_CABELLO = [op('NEGRO', 'Negro'), op('CASTANO', 'Castaño'), op('RUBIO', 'Rubio'), op('PELIRROJO', 'Pelirrojo'), op('CANOSO', 'Canoso'), op('SIN_CABELLO', 'Sin cabello')];
const DIALECTOS = [op('NEUTRO', 'Neutro'), op('BOYACENSE', 'Boyacense'), op('CACHACO', 'Cachaco (Bogotá)'), op('PAISA', 'Paisa'), op('COSTENO', 'Costeño (Caribe)'),
  op('VALLUNO', 'Valluno'), op('SANTANDEREANO', 'Santandereano'), op('LLANERO', 'Llanero'), op('PACIFICO', 'Pacífico'), op('PASTUSO', 'Pastuso')];
const PROVINCIAS = [op('CENTRO', 'Centro'), op('GUTIERREZ', 'Gutiérrez'), op('LA_LIBERTAD', 'La Libertad'), op('LENGUPA', 'Lengupá'), op('MARQUEZ', 'Márquez'),
  op('NEIRA', 'Neira'), op('NORTE', 'Norte'), op('OCCIDENTE', 'Occidente'), op('ORIENTE', 'Oriente'), op('RICAURTE', 'Ricaurte'), op('SUGAMUXI', 'Sugamuxi'),
  op('TUNDAMA', 'Tundama'), op('VALDERRAMA', 'Valderrama'), op('FUERA_DE_BOYACA', 'Fuera de Boyacá')];
const MODALIDADES = [op('PRESENCIAL', 'Presencial'), op('VIRTUAL', 'Virtual'), op('HIBRIDA', 'Híbrida')];
const TIPOS_DOCUMENTO = ['CC', 'CE', 'PASAPORTE', 'NIT'];

const codigos = (l) => l.map((o) => o.codigo);
const valido = (lista, v) => v === null || v === undefined || v === '' || codigos(lista).includes(v);

module.exports = { GENEROS, TONOS_PIEL, COLORES_OJOS, COLORES_CABELLO, DIALECTOS, PROVINCIAS, MODALIDADES, TIPOS_DOCUMENTO, codigos, valido };
