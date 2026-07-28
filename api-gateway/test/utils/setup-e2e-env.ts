// Roda antes de cada suíte e2e (`setupFiles` em test/jest-e2e.json).
//
// Fixa as variáveis que o AppModule lê no boot para que a suíte não dependa do
// .env da máquina de quem roda. O ConfigModule usa dotenv, que nunca sobrescreve
// uma variável já presente em process.env — então o que é definido aqui vence.
//
// As URLs dos downstream apontam para hosts inexistentes de propósito: nenhuma
// suíte do `npm run test:e2e` deve alcançar a rede. Se um teste vazar uma
// chamada real, ela falha rápido em vez de acertar um serviço que por acaso
// esteja rodando na máquina.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';
process.env.USERS_SERVICE_URL = 'http://users-service.invalid';
process.env.PRODUCTS_SERVICE_URL = 'http://products-service.invalid';
process.env.CHECKOUT_SERVICE_URL = 'http://checkout-service.invalid';
process.env.PAYMENTS_SERVICE_URL = 'http://payments-service.invalid';
