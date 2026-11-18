import type { Budget, FinanceSummary, Transaction } from "./models";

export function summarize(transactions: Transaction[], openingBalanceCents = 0): FinanceSummary {
  const relevant = transactions.filter((item) => item.status !== "cancelled");
  const incomeReceivedCents = relevant.filter((item) => item.type === "income" && item.status === "received").reduce((sum, item) => sum + item.amountCents, 0);
  const expensesPaidCents = relevant.filter((item) => item.type !== "income" && item.status === "paid").reduce((sum, item) => sum + item.amountCents, 0);
  const billsPendingCents = relevant.filter((item) => item.type === "bill" && ["pending", "overdue"].includes(item.status)).reduce((sum, item) => sum + item.amountCents, 0);
  const incomeExpectedCents = relevant.filter((item) => item.type === "income" && item.status === "pending").reduce((sum, item) => sum + item.amountCents, 0);
  return { incomeReceivedCents, expensesPaidCents, billsPendingCents, incomeExpectedCents, availableCents: openingBalanceCents + incomeReceivedCents - expensesPaidCents, projectedCents: openingBalanceCents + incomeReceivedCents + incomeExpectedCents - expensesPaidCents - billsPendingCents };
}

function budgetPeriodKey(year: number, month: number) { return `${year}-${String(month).padStart(2, "0")}`; }

export function budgetIsActiveInMonth(budget: Budget, monthKey: string): boolean {
  if (budget.periodType === "recurring") return true;
  if (!budget.periodType) return budget.month === monthKey;
  if (budget.startMonth == null || budget.startYear == null) return false;
  const start = budgetPeriodKey(budget.startYear, budget.startMonth);
  if (budget.periodType === "specific_month") return monthKey === start;
  if (budget.periodType === "custom_range") {
    if (budget.endMonth == null || budget.endYear == null) return false;
    const end = budgetPeriodKey(budget.endYear, budget.endMonth);
    return monthKey >= start && monthKey <= end;
  }
  return false;
}

export function activeBudgetsForMonth(budgets: Budget[], monthKey: string): Budget[] {
  return budgets.filter((budget) => budgetIsActiveInMonth(budget, monthKey));
}

export function budgetCategoriesForMonth(budgets: Budget[], monthKey: string): string[] {
  return Array.from(new Set(activeBudgetsForMonth(budgets, monthKey).map((budget) => budget.category))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function budgetUsage(budget: Budget, transactions: Transaction[], monthKey: string) {
  const spentCents = transactions.filter((item) => item.type !== "income" && item.status === "paid" && item.category === budget.category && item.date.startsWith(monthKey)).reduce((sum, item) => sum + item.amountCents, 0);
  return { spentCents, remainingCents: budget.limitCents - spentCents, percentage: budget.limitCents === 0 ? 0 : Math.min(100, Math.round(spentCents / budget.limitCents * 100)), exceededCents: Math.max(0, spentCents - budget.limitCents) };
}
