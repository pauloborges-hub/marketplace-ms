// Roda antes de cada suíte e2e (`setupFiles` em test/jest-e2e.json).
//
// Fixa as variáveis que o AppModule lê no boot para que a suíte não dependa do
// .env da máquina de quem roda. O ConfigModule usa dotenv, que nunca sobrescreve
// uma variável já presente em process.env — então o que é definido aqui vence.
//
// PRODUCTS_SERVICE_URL é lido com `getOrThrow` pelo ProductsClientModule, então
// precisa existir mesmo com o ProductsClientService mockado: o HttpModule é
// construído antes de qualquer override.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
process.env.PRODUCTS_SERVICE_URL =
  process.env.PRODUCTS_SERVICE_URL ?? 'http://products-service.invalid';
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq.invalid:5672';
