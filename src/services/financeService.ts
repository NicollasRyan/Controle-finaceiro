import { getDocs, runTransaction, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Budget, FinanceNotification, Transaction } from "@/domain/models";
import { occurrenceDates, occurrenceId } from "@/domain/recurrences";
import { activeBudgetsForMonth, budgetUsage } from "@/domain/finance";
import { localDateString } from "@/lib/format";
import { listRecurrences, listTransactions } from "@/repositories/financeRepository";
import { omitUndefined } from "@/lib/firestoreData";
import { assertAuthenticatedUser, userCollection, userDocument } from "@/lib/firestoreAccess";

export async function generateOccurrences(uid: string, month: string) {
  const recurrences = await listRecurrences(uid);
  for (const rule of recurrences.filter((item) => item.active)) {
    for (const date of occurrenceDates(rule, month)) {
      const id = occurrenceId(rule.id, date);
      const ref = userDocument(uid, "transactions", id);
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(ref);
        const isOverdue = rule.type === "bill" && date < localDateString();
        if (existing.exists()) {
          if (isOverdue && existing.data().status === "pending") tx.update(ref, { status: "overdue" });
          return;
        }
        const entry: Omit<Transaction, "id"> = { description: rule.name, amountCents: rule.amountCents, type: rule.type, status: isOverdue ? "overdue" : "pending", date, category: rule.category, recurrenceId: rule.id, createdAt: Date.now() };
        tx.set(ref, omitUndefined({ ...entry, createdAt: serverTimestamp() }));
      });
    }
  }
}

export async function setTransactionStatus(uid: string, transaction: Transaction, status: "paid" | "received") {
  const ref = userDocument(uid, "transactions", transaction.id);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (!existing.exists()) throw new Error("Movimentação não encontrada.");
    tx.update(ref, omitUndefined({ status, settledDate: localDateString() }));
  });
}

export async function syncNotifications(uid: string, month: string, budgets: Budget[]) {
  assertAuthenticatedUser(uid);
  const [transactions, current] = await Promise.all([listTransactions(uid), getDocs(userCollection(uid, "notifications"))]);
  const existing = new Set(current.docs.map((item) => item.id));
  const today = localDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateString(tomorrowDate);
  const candidates: FinanceNotification[] = [];
  for (const item of transactions) {
    if (item.type !== "bill" || !["pending", "overdue"].includes(item.status) || ![today, tomorrow].includes(item.date)) continue;
    candidates.push({ id: `due_${item.id}`, title: item.date === today ? "Conta vence hoje" : "Conta vence amanhã", body: `${item.description} · ${item.date === today ? "vence hoje" : "vence amanhã"} · R$ ${(item.amountCents / 100).toFixed(2).replace(".", ",")}`, kind: "due", createdAt: Date.now(), read: false });
  }
  for (const budget of activeBudgetsForMonth(budgets, month)) {
    const usage = budgetUsage(budget, transactions, month);
    if (usage.percentage < 80) continue;
    const exceeded = usage.exceededCents > 0;
    candidates.push({ id: `budget_${month}_${budget.id}_${exceeded ? "exceeded" : "80"}`, title: exceeded ? "Limite de gastos ultrapassado" : "Você chegou a 80% do limite", body: `${budget.category} · ${exceeded ? `excedeu R$ ${(usage.exceededCents / 100).toFixed(2).replace(".", ",")}` : `${usage.percentage}% do limite utilizado`}`, kind: "budget", createdAt: Date.now(), read: false });
  }
  const pending = candidates.filter((item) => !existing.has(item.id));
  if (pending.length) {
    const batch = writeBatch(db);
    for (const item of pending) batch.set(userDocument(uid, "notifications", item.id), omitUndefined(item));
    await batch.commit();
  }
}
