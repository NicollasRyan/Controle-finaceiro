import { addDoc, deleteDoc, deleteField, getDoc, getDocs, setDoc, updateDoc, type UpdateData } from "firebase/firestore";
import type { Budget, FinanceNotification, Recurrence, Transaction } from "@/domain/models";
import { omitUndefined } from "@/lib/firestoreData";
import { userCollection, userDocument } from "@/lib/firestoreAccess";

export async function listDocuments<T extends { id: string }>(uid: string, name: string): Promise<T[]> {
  const snapshot = await getDocs(userCollection(uid, name));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T));
}
export const listTransactions = (uid: string) => listDocuments<Transaction>(uid, "transactions");
export const listRecurrences = (uid: string) => listDocuments<Recurrence>(uid, "recurrences");
export const listBudgets = (uid: string) => listDocuments<Budget>(uid, "budgets");
export const listNotifications = (uid: string) => listDocuments<FinanceNotification>(uid, "notifications");
export async function addTransaction(uid: string, value: Omit<Transaction, "id">) { const result = await addDoc(userCollection(uid, "transactions"), omitUndefined(value)); return result.id; }
export async function saveRecurrence(uid: string, value: Recurrence) { await setDoc(userDocument(uid, "recurrences", value.id), omitUndefined(value)); }
export async function saveBudget(uid: string, value: Budget) { await setDoc(userDocument(uid, "budgets", value.id), omitUndefined(value)); }
export async function removeBudget(uid: string, id: string) { await deleteDoc(userDocument(uid, "budgets", id)); }
export async function markNotificationRead(uid: string, id: string) { await updateDoc(userDocument(uid, "notifications", id), { read: true }); }
export async function getOpeningBalance(uid: string) { const snapshot = await getDoc(userDocument(uid, "settings", "general")); return Number(snapshot.data()?.openingBalanceCents ?? 0); }
export async function saveOpeningBalance(uid: string, openingBalanceCents: number) { await setDoc(userDocument(uid, "settings", "general"), { openingBalanceCents }, { merge: true }); }
export async function patchTransaction(uid: string, id: string, values: Partial<Transaction>) {
  const transactionRef = userDocument(uid, "transactions", id);
  const update: UpdateData<Transaction> = omitUndefined(values);
  if (Object.hasOwn(values, "category") && values.category === undefined) update.category = deleteField();
  if (Object.hasOwn(values, "note") && values.note === undefined) update.note = deleteField();
  await updateDoc(transactionRef, update);
}
export async function removeTransaction(uid: string, id: string) { await deleteDoc(userDocument(uid, "transactions", id)); }
