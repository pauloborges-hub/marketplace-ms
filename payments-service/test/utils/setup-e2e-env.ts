// Roda antes de cada suíte e2e (`setupFiles` em test/jest-e2e.json).
//
// Fixa as variáveis que os módulos leem no boot para que a suíte não dependa do
// .env da máquina de quem roda. O ConfigModule usa dotenv, que nunca sobrescreve
// uma variável já presente em process.env — então o que é definido aqui vence.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq.invalid:5672';
