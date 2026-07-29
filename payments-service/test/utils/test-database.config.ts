import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { Payment } from '../../src/payments/entities/payment.entity';
import { applySqliteCompatibility } from './sqlite-compat';

// Substitui o Postgres nos testes e2e via `moduleNameMapper` (test/jest-e2e.json):
// todo import de `src/config/database.config` resolve para este arquivo, então os
// módulos reais sobem sem que uma única linha de código de produção mude.
//
// O driver é o `sqljs` (SQLite compilado para WebAssembly) em vez de
// `better-sqlite3`/`sqlite3`: os dois exigem compilação nativa, que falha neste
// ambiente (os headers do Node 25 pedem <source_location>, ausente na toolchain
// instalada). O `sqljs` é o mesmo SQLite, só que em WASM — zero build nativo e o
// banco vive inteiramente em memória.
//
// As entidades são importadas explicitamente (em vez de por glob) porque os
// decorators precisam ter rodado antes de `applySqliteCompatibility()` reescrever
// os tipos incompatíveis com SQLite.
applySqliteCompatibility();

// Cada suíte recebe um banco vazio: nada é persistido em disco
// (`autoSave: false`) e `dropSchema` + `synchronize` recriam o schema a cada boot.
export const databaseConfig: TypeOrmModuleOptions = {
  type: 'sqljs',
  autoSave: false,
  entities: [Payment],
  synchronize: true,
  dropSchema: true,
  logging: false,
};
