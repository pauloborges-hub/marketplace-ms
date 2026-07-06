# SPEC: Login de usuário (`POST /auth/login`)

> **Objetivo:** Permitir que um usuário já cadastrado (seller ou buyer) se autentique no
> `users-service` informando e-mail e senha, recebendo em troca um token JWT.
>
> **Escopo desta spec:** endpoint de login, verificação de credenciais e emissão do token JWT.
> **Fora de escopo:** proteção de rotas (guards de autenticação/autorização), refresh tokens,
> sessões, logout, recuperação de senha ou qualquer outro endpoint de `auth` ou de `users`.
> Tudo isso será tratado em specs futuras.

---

## 1. Contexto

Esta é a terceira spec do `users-service`, na sequência de [`02 - user-registration`](./02%20-%20user-registration.md). O que já existe hoje:

- Entidade `User` (`id`, `email`, `password`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`), com `role` (`seller`/`buyer`) e `status` (`active`/`inactive`) como enums.
- `AuthModule`, com `AuthController` e `AuthService`, importado pelo `AppModule`.
- Endpoint `POST /auth/register` funcionando, incluindo hash de senha com `bcryptjs` (10 salt rounds).
- `ValidationPipe` global habilitado (`transform`, `whitelist`, `forbidNonWhitelisted`).

Esta spec adiciona a segunda funcionalidade real do serviço: autenticação via e-mail/senha, com emissão de um token JWT.

---

## 2. Stack e padrões

- **Framework:** NestJS 11 (mesmo padrão dos módulos existentes).
- **ORM:** TypeORM, via repositório da entidade `User` já registrada no `UsersModule`.
- **Comparação de senha:** `bcryptjs` (mesma lib usada no registro).
- **Emissão de JWT:** `@nestjs/jwt` (e `@nestjs/passport` + `passport` + `passport-jwt` como dependências da stack de autenticação, ainda que a validação de token via guard fique fora do escopo desta spec).
- **Validação:** `class-validator` + `class-transformer` (já configurados globalmente).
- **Configuração:** o secret do JWT deve vir de variável de ambiente (`JWT_SECRET`), nunca hardcoded no código.
- O projeto deve continuar **enxuto** — sem dependências ou abstrações além do necessário para esta spec.

---

## 3. Requisitos funcionais

### RF1 — Endpoint `POST /auth/login`
- Deve expor a rota `POST /auth/login`, que recebe e-mail e senha no corpo da requisição.
- A responsabilidade de orquestrar o login (buscar usuário, validar senha, validar status, gerar token) pertence ao `AuthService`; o controller apenas recebe a requisição e delega.

### RF2 — Busca do usuário pelo e-mail
- O sistema deve buscar, no banco, um usuário cujo e-mail corresponda exatamente ao e-mail informado (mesma regra de normalização de case usada no registro, para consistência: `Foo@Bar.com` e `foo@bar.com` devem ser tratados como o mesmo e-mail).
- Se nenhum usuário for encontrado com o e-mail informado, o login deve ser rejeitado com **401 Unauthorized** e a mensagem genérica "Credenciais inválidas".

### RF3 — Verificação da senha
- Se o usuário for encontrado, a senha informada em texto plano deve ser comparada com o hash armazenado no campo `password`, usando bcrypt.
- Se a senha não corresponder ao hash, o login deve ser rejeitado com **401 Unauthorized** e a mensagem genérica "Credenciais inválidas" — a mesma mensagem usada quando o e-mail não existe (RF2), para não revelar a um atacante qual dos dois campos está incorreto.

### RF4 — Verificação de status da conta
- Após confirmar e-mail e senha corretos, o sistema deve verificar se o `status` do usuário é `active`.
- Se o `status` for diferente de `active` (ou seja, `inactive`), o login deve ser rejeitado com **401 Unauthorized** e a mensagem específica "Conta inativa" (diferente da mensagem de credenciais inválidas, pois aqui o e-mail e a senha já foram confirmados como corretos).
- Esta verificação só deve ocorrer depois que e-mail e senha já tiverem sido validados (RF2 e RF3) — nunca antes, para não vazar, através de mensagens diferentes, se um e-mail existe no sistema.

### RF5 — Emissão do token JWT
- Se e-mail, senha e status forem todos válidos, o sistema deve gerar um token JWT assinado.
- O token deve ter expiração de **24 horas** a partir do momento da emissão.
- O payload do token deve conter os dados descritos na seção 4.2.
- O secret usado para assinar o token deve ser lido da variável de ambiente `JWT_SECRET`.

### RF6 — Resposta de sucesso
- Em caso de sucesso, a resposta deve conter o objeto do usuário autenticado (sem o campo `password`, seguindo a mesma regra de omissão já aplicada no registro) e o token JWT gerado.
- Estrutura da resposta: `{ user: {...}, token: "..." }` (ver seção 4.3).

### RF7 — Validação dos dados de entrada
- Todos os campos do DTO de login (seção 4.1) devem ser validados antes de qualquer acesso ao banco.
- Requisições com dados inválidos devem ser rejeitadas com **400 Bad Request**, sem chegar a consultar o banco.
- Campos não previstos no DTO enviados pelo cliente devem ser descartados/rejeitados, conforme o comportamento já garantido pelo `ValidationPipe` global (`whitelist: true`, `forbidNonWhitelisted: true`).

### RF8 — Configuração do JWT
- O secret do JWT (`JWT_SECRET`) deve ser configurável via variável de ambiente, sem valor padrão hardcoded que funcione em produção.
- O tempo de expiração (24 horas) deve estar definido de forma centralizada na configuração do módulo de JWT, e não espalhado/duplicado pelo código.

---

## 4. Estrutura de dados

### 4.1 DTO de entrada — `LoginDto` (corpo de `POST /auth/login`)

| Campo      | Tipo   | Regras                                    |
| ---------- | ------ | ------------------------------------------ |
| `email`    | string | Obrigatório. Deve ser um e-mail válido.    |
| `password` | string | Obrigatório. Mínimo de **6 caracteres**.   |

- Nenhum outro campo é aceito neste DTO.

### 4.2 Payload do JWT

| Campo   | Tipo             | Origem                                   |
| ------- | ---------------- | ------------------------------------------ |
| `sub`   | string (UUID)     | `id` do usuário autenticado.               |
| `email` | string            | `email` do usuário autenticado.            |
| `role`  | enum (`seller`/`buyer`) | `role` do usuário autenticado.       |

- O payload não deve conter, em nenhuma hipótese, o campo `password` (hash ou texto plano).

### 4.3 Corpo da resposta de sucesso

```
{
  "user": { ... },
  "token": "..."
}
```

| Campo         | Tipo  | Descrição                                                                 |
| ------------- | ----- | --------------------------------------------------------------------------- |
| `user`        | objeto | Usuário autenticado, contendo apenas: `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt` (sem `password`). |
| `token`       | string | Token JWT assinado, válido por 24 horas, com o payload da seção 4.2.       |

---

## 5. Respostas esperadas

### 200 OK
- Login realizado com sucesso (e-mail encontrado, senha correta, conta ativa).
- Corpo da resposta: conforme seção 4.3.

### 401 Unauthorized
- Cobre três cenários, com corpos de resposta distintos:
  - **E-mail não encontrado:** mensagem genérica "Credenciais inválidas".
  - **Senha incorreta:** mensagem genérica "Credenciais inválidas" (idêntica à do e-mail não encontrado).
  - **Conta inativa** (e-mail e senha corretos, mas `status != active`): mensagem específica "Conta inativa".
- Em nenhum dos três cenários um token é gerado ou retornado.

### 400 Bad Request
- Um ou mais campos do corpo da requisição são inválidos, estão ausentes, ou o corpo contém campos não previstos no DTO.
- Nenhuma busca no banco ou tentativa de autenticação é realizada.

---

## 6. Critérios de aceite

Cada critério deve ser verificável de forma objetiva:

- [ ] **CA1** — Uma requisição `POST /auth/login` com e-mail e senha corretos de um usuário com `status = active` retorna **200** e um corpo no formato `{ user: {...}, token: "..." }`.
- [ ] **CA2** — O `user` retornado no CA1 contém `id`, `email`, `firstName`, `lastName`, `role`, `status`, `createdAt`, `updatedAt`, e **não** contém o campo `password` em nenhum nível.
- [ ] **CA3** — O `token` retornado no CA1 é um JWT válido, assinado com o secret configurado em `JWT_SECRET`, cujo payload decodificado contém exatamente `sub` (igual ao `id` do usuário), `email` e `role`, e cuja expiração (`exp`) corresponde a 24 horas após a emissão (`iat`).
- [ ] **CA4** — Uma requisição com e-mail que não existe no banco retorna **401 Unauthorized** com a mensagem "Credenciais inválidas".
- [ ] **CA5** — Uma requisição com e-mail existente e senha incorreta retorna **401 Unauthorized** com a mensagem "Credenciais inválidas" (mesma mensagem e mesmo status do CA4).
- [ ] **CA6** — Uma requisição com e-mail e senha corretos, mas de um usuário com `status = inactive`, retorna **401 Unauthorized** com a mensagem "Conta inativa" (diferente da mensagem do CA4/CA5).
- [ ] **CA7** — Nenhum dos cenários de erro (CA4, CA5, CA6) gera ou retorna um token.
- [ ] **CA8** — Enviar o corpo sem `email`, com `email` em formato inválido, sem `password`, ou com `password` menor que 6 caracteres — cada um desses casos, isoladamente, retorna **400 Bad Request**, sem consultar o banco.
- [ ] **CA9** — Enviar campos fora do DTO (ex.: `role`, `status`) no corpo da requisição retorna **400 Bad Request**.
- [ ] **CA10** — Nenhuma das respostas (200, 400 ou 401) expõe o campo `password`.
- [ ] **CA11** — O endpoint `POST /auth/login` não realiza nenhuma verificação de guard/proteção de rota nem emite refresh tokens — apenas a emissão do JWT de acesso descrita nesta spec.

---

## 7. Dependências e sequência

Depende da spec [`02 - user-registration`](./02%20-%20user-registration.md) (entidade `User`, `AuthModule`, hash de senha via bcrypt já existentes).

Requer a adição das dependências de runtime `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` ao `package.json` do `users-service` (bcryptjs já é dependência existente), e a configuração da variável de ambiente `JWT_SECRET`.

Specs futuras (fora do escopo aqui) provavelmente cobrirão, nesta ordem sugerida:
1. Proteção de rotas com guards (`JwtAuthGuard`) e validação de token em endpoints protegidos.
2. Refresh tokens / renovação de sessão.
3. Integração da autenticação com o `api-gateway`.
