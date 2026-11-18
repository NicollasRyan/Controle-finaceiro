import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetCategoriesForMonth, budgetIsActiveInMonth, budgetUsage, summarize } from "./finance";
import { occurrenceDates, occurrenceId } from "./recurrences";
import type { Budget, Recurrence, Transaction } from "./models";
import { budgetSchema, transactionSchema } from "./schemas";

const entry = (overrides: Partial<Transaction>): Transaction => ({ id: "t", description: "Teste", amountCents: 0, type: "expense", status: "paid", date: "2026-11-01", createdAt: 0, ...overrides });

describe("resumo financeiro", () => {
  it("separa dinheiro recebido, pagamentos e compromissos futuros", () => {
    const result = summarize([
      entry({ id: "salary", type: "income", status: "received", amountCents: 250000 }),
      entry({ id: "paid", amountCents: 45000 }),
      entry({ id: "bill", type: "bill", status: "pending", amountCents: 30000 }),
      entry({ id: "expected", type: "income", status: "pending", amountCents: 50000 }),
    ], 10000);
    assert.deepEqual(result, { incomeReceivedCents: 250000, expensesPaidCents: 45000, billsPendingCents: 30000, incomeExpectedCents: 50000, availableCents: 215000, projectedCents: 235000 });
  });

  it("não conta movimentações canceladas", () => {
    const result = summarize([entry({ status: "cancelled", amountCents: 999999 })]);
    assert.equal(result.expensesPaidCents, 0);
    assert.equal(result.availableCents, 0);
  });

  it("conta uma conta recorrente paga uma vez e exclui uma pendente", () => {
    const budget: Budget = { id: "b", category: "Casa", month: "2026-11", limitCents: 10000 };
    const result = budgetUsage(budget, [
      entry({ type: "bill", status: "paid", category: "Casa", amountCents: 3000 }),
      entry({ id: "pending", type: "bill", status: "pending", category: "Casa", amountCents: 9000 }),
      entry({ id: "uncategorized", category: undefined, amountCents: 1000 }),
      entry({ id: "other-month", date: "2026-10-31", category: "Casa", amountCents: 1000 }),
    ], "2026-11");
    assert.deepEqual(result, { spentCents: 3000, remainingCents: 7000, percentage: 30, exceededCents: 0 });
  });

  it("informa com exatidão o excedente do limite", () => {
    const budget: Budget = { id: "b", category: "Lazer", month: "2026-11", limitCents: 10000 };
    const result = budgetUsage(budget, [entry({ category: "Lazer", amountCents: 12450 })], "2026-11");
    assert.equal(result.exceededCents, 2450);
    assert.equal(result.percentage, 100);
    assert.equal(result.remainingCents, -2450);
  });
});

describe("validade dos limites e categorias", () => {
  const recurring: Budget = { id: "rec", category: "Alimentação", limitCents: 40000, periodType: "recurring", startMonth: null, startYear: null, endMonth: null, endYear: null };
  const january: Budget = { id: "jan", category: "Lanche de viagem", limitCents: 30000, periodType: "specific_month", startMonth: 1, startYear: 2027, endMonth: null, endYear: null };
  const range: Budget = { id: "range", category: "Viagem", limitCents: 90000, periodType: "custom_range", startMonth: 1, startYear: 2027, endMonth: 3, endYear: 2027 };

  it("mantém categorias recorrentes disponíveis em meses diferentes", () => {
    assert.equal(budgetIsActiveInMonth(recurring, "2026-11"), true);
    assert.equal(budgetIsActiveInMonth(recurring, "2027-01"), true);
    assert.equal(budgetIsActiveInMonth(recurring, "2030-12"), true);
  });

  it("ativa um limite específico somente no mês selecionado", () => {
    assert.equal(budgetIsActiveInMonth(january, "2026-11"), false);
    assert.equal(budgetIsActiveInMonth(january, "2026-12"), false);
    assert.equal(budgetIsActiveInMonth(january, "2027-01"), true);
    assert.equal(budgetIsActiveInMonth(january, "2027-02"), false);
  });

  it("altera imediatamente as categorias disponíveis conforme a data escolhida", () => {
    const budgets = [recurring, january];
    assert.deepEqual(budgetCategoriesForMonth(budgets, "2026-11"), ["Alimentação"]);
    assert.deepEqual(budgetCategoriesForMonth(budgets, "2027-01"), ["Alimentação", "Lanche de viagem"]);
    assert.deepEqual(budgetCategoriesForMonth(budgets, "2027-02"), ["Alimentação"]);
  });

  it("inclui os dois meses extremos do período personalizado", () => {
    assert.deepEqual(["2026-12", "2027-01", "2027-02", "2027-03", "2027-04"].map((month) => budgetIsActiveInMonth(range, month)), [false, true, true, true, false]);
  });

  it("mantém limites antigos somente no mês legado e não os apaga", () => {
    const legacy: Budget = { id: "old", category: "Transporte", limitCents: 12000, month: "2026-11" };
    assert.equal(budgetIsActiveInMonth(legacy, "2026-11"), true);
    assert.equal(budgetIsActiveInMonth(legacy, "2026-12"), false);
    assert.equal(legacy.limitCents, 12000);
  });

  it("calcula gasto somente no mês-alvo e ignora pendentes e receitas", () => {
    const result = budgetUsage(recurring, [
      entry({ amountCents: 10000, category: "Alimentação", date: "2027-01-15" }),
      entry({ id: "pending", amountCents: 50000, category: "Alimentação", status: "pending", date: "2027-01-16" }),
      entry({ id: "income", amountCents: 90000, category: "Alimentação", type: "income", status: "received", date: "2027-01-17" }),
      entry({ id: "previous", amountCents: 30000, category: "Alimentação", date: "2026-12-31" }),
    ], "2027-01");
    assert.equal(result.spentCents, 10000);
  });
});

describe("formulário simples de receita", () => {
  it("aceita descrição, valor e data sem categoria ou observação", () => {
    assert.equal(transactionSchema.safeParse({ description: "Salário", amount: 2500, date: "2027-01-05" }).success, true);
  });
});

describe("validação dos períodos de limite", () => {
  it("aceita limite recorrente sem datas de término", () => {
    assert.equal(budgetSchema.safeParse({ category: "Alimentação", limit: 400, periodType: "recurring" }).success, true);
  });
  it("aceita mês específico e intervalo inclusivo", () => {
    assert.equal(budgetSchema.safeParse({ category: "Viagem", limit: 300, periodType: "specific_month", startPeriod: "2027-01" }).success, true);
    assert.equal(budgetSchema.safeParse({ category: "Viagem", limit: 300, periodType: "custom_range", startPeriod: "2027-01", endPeriod: "2027-03" }).success, true);
  });
  it("recusa intervalo final anterior ao inicial", () => {
    assert.equal(budgetSchema.safeParse({ category: "Viagem", limit: 300, periodType: "custom_range", startPeriod: "2027-03", endPeriod: "2027-01" }).success, false);
  });
});

describe("ocorrências recorrentes", () => {
  const rule: Recurrence = { id: "spotify", name: "Spotify", amountCents: 2190, type: "bill", day: 31, frequency: "monthly", startDate: "2026-01-01", active: true };
  it("ajusta vencimentos mensais ao último dia do mês", () => {
    assert.deepEqual(occurrenceDates(rule, "2026-02"), ["2026-02-28"]);
  });
  it("gera apenas as semanas dentro do período configurado", () => {
    const weekly = { ...rule, frequency: "weekly" as const, day: 1, startDate: "2026-11-10", endDate: "2026-11-24" };
    assert.deepEqual(occurrenceDates(weekly, "2026-11"), ["2026-11-16", "2026-11-23"]);
  });
  it("usa IDs determinísticos para não repetir a mesma ocorrência", () => {
    assert.equal(occurrenceId("spotify", "2026-11-10"), occurrenceId("spotify", "2026-11-10"));
    assert.notEqual(occurrenceId("spotify", "2026-11-10"), occurrenceId("spotify", "2026-12-10"));
  });
  it("gera ocorrência anual somente no mês de início", () => {
    const yearly = { ...rule, frequency: "yearly" as const, day: 5, startDate: "2025-03-01" };
    assert.deepEqual(occurrenceDates(yearly, "2026-03"), ["2026-03-05"]);
    assert.deepEqual(occurrenceDates(yearly, "2026-04"), []);
  });
});
