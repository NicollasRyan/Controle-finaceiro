import { z } from "zod";

const money = z.coerce.number().positive("Informe um valor maior que zero.").max(99999999, "Valor muito alto.");
export const transactionSchema = z.object({
  description: z.string().trim().min(2, "Informe uma descrição.").max(80),
  amount: money,
  date: z.string().min(1, "Informe a data."),
  category: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
});
export type TransactionInput = z.infer<typeof transactionSchema>;

export const recurrenceSchema = z.object({
  name: z.string().trim().min(2).max(80), amount: money,
  type: z.enum(["income", "bill"]), day: z.coerce.number().int().min(0).max(31),
  frequency: z.enum(["weekly", "monthly", "yearly"]), startDate: z.string().min(1),
  endDate: z.string().optional(), category: z.string().trim().max(40).optional(),
}).superRefine((values, ctx) => {
  if (values.frequency === "weekly" && values.day > 6) ctx.addIssue({ code: "custom", path: ["day"], message: "Para frequência semanal, use 0 (domingo) a 6 (sábado)." });
  if (values.frequency !== "weekly" && values.day < 1) ctx.addIssue({ code: "custom", path: ["day"], message: "Informe um dia entre 1 e 31." });
  if (values.endDate && values.endDate < values.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "A data final deve ser posterior ao início." });
});
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;

export const budgetSchema = z.object({
  category: z.string().trim().min(1, "Informe uma categoria.").max(40),
  limit: money,
  periodType: z.enum(["specific_month", "recurring", "custom_range"]),
  startPeriod: z.string().optional(),
  endPeriod: z.string().optional(),
}).superRefine((value, ctx) => {
  const validMonth = (month: string | undefined) => Boolean(month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month));
  if (value.periodType !== "recurring" && !validMonth(value.startPeriod)) {
    ctx.addIssue({ code: "custom", path: ["startPeriod"], message: "Selecione o mês e o ano inicial." });
  }
  if (value.periodType === "custom_range") {
    if (!validMonth(value.endPeriod)) ctx.addIssue({ code: "custom", path: ["endPeriod"], message: "Selecione o mês e o ano final." });
    else if (value.startPeriod && value.endPeriod && value.endPeriod < value.startPeriod) {
      ctx.addIssue({ code: "custom", path: ["endPeriod"], message: "O fim deve ser no mesmo mês ou depois do início." });
    }
  }
});
export type BudgetInput = z.infer<typeof budgetSchema>;
