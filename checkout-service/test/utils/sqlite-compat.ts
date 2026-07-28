import { getMetadataArgsStorage } from 'typeorm';

// As entidades declaram tipos nativos do Postgres (`enum`, `timestamp`) que o
// SQLite não conhece — sem isso o boot morre em
// `DataTypeNotSupportedError: Data type "enum" ... is not supported`.
//
// Em vez de mudar as entidades (código de produção), reescrevemos os metadados
// que os decorators registraram, no processo de teste, para os equivalentes que
// o SQLite entende. `simple-enum` guarda o valor como varchar e mantém a
// validação de enum do TypeORM, então as asserções sobre role/status continuam
// valendo exatamente como no Postgres.
const TYPE_REPLACEMENTS: Record<string, string> = {
  enum: 'simple-enum',
  timestamp: 'datetime',
  timestamptz: 'datetime',
  jsonb: 'simple-json',
  json: 'simple-json',
};

let applied = false;

export function applySqliteCompatibility(): void {
  // O storage de metadados do TypeORM é global e os decorators só rodam uma vez
  // por processo; reaplicar seria inofensivo, mas o guard deixa isso explícito.
  if (applied) {
    return;
  }
  applied = true;

  for (const column of getMetadataArgsStorage().columns) {
    const declaredType = column.options?.type;

    if (typeof declaredType !== 'string') {
      continue;
    }

    const replacement = TYPE_REPLACEMENTS[declaredType];
    if (replacement) {
      column.options = { ...column.options, type: replacement };
    }
  }
}
