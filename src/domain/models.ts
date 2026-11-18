export type TransactionType = "income" | "expense" | "bill";
export type TransactionStatus = "received" | "paid" | "pending" | "overdue" | "cancelled";
export type Frequency = "weekly" | "monthly" | "yearly";

export interface Transaction {
  id: string;
  description: string;
  amountCents: number;
  type: TransactionType;
  status: TransactionStatus;
  date: string;
  category?: string;
  note?: string;
  recurrenceId?: string;
  createdAt: number;
}

export interface Recurrence {
  id: string;
  name: string;
  amountCents: number;
  type: "income" | "bill";
  day: number;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  category?: string;
  active: boolean;
}

export type BudgetPeriodType = "specific_month" | "recurring" | "custom_range";
export interface Budget {
  id: string;
  userId?: string;
  category: string;
  limitCents: number;
  periodType?: BudgetPeriodType;
  startMonth?: number | null;
  startYear?: number | null;
  endMonth?: number | null;
  endYear?: number | null;
  createdAt?: number;
  updatedAt?: number;
  /** Legacy field used by limits created before validity periods were added. */
  month?: string;
}
export interface FinanceNotification { id: string; title: string; body: string; kind: "due" | "budget"; createdAt: number; read: boolean }
export interface FinanceSummary {
  incomeReceivedCents: number; expensesPaidCents: number; billsPendingCents: number;
  incomeExpectedCents: number; availableCents: number; projectedCents: number;
}
