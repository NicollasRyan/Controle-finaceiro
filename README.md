# Controle Financeiro

Aplicação pessoal de controle financeiro em Next.js App Router, TypeScript e Firebase. Regras monetárias usam centavos inteiros; documentos pertencem ao usuário autenticado em `users/{uid}`.

## Estrutura

- `src/app`: páginas e shell da aplicação.
- `src/components`: navegação, formulários e componentes visuais.
- `src/domain`: modelos, validações e cálculos sem dependência da interface.
- `src/repositories`: acesso ao Firestore.
- `src/services`: operações de domínio e geração idempotente de ocorrências.
- `src/lib`: Firebase e formatação.
- `firestore.rules`: isolamento dos dados por usuário.

## Executar

1. Configure um projeto Firebase, habilite Email/Senha em Authentication e crie o Firestore.
2. Copie `.env.example` para `.env.local` e preencha as credenciais do app web Firebase.
3. Execute `yarn install` e `yarn dev`.

O cliente não usa credenciais administrativas. As regras do Firestore devem ser publicadas antes de usar em produção. A geração das ocorrências recorrentes acontece de forma idempotente ao abrir a área correspondente; lembretes agendados exigem Cloud Functions/Cloud Scheduler e não são simulados nesta versão.

## Dados

Os registros ficam em `users/{uid}/transactions`, `users/{uid}/recurrences`, `users/{uid}/budgets`, `users/{uid}/categories` e `users/{uid}/notifications`. Transações recorrentes têm IDs determinísticos por modelo e período, impedindo duplicação.
