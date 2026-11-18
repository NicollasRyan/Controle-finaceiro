import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omitUndefined } from "./firestoreData";

describe("omitUndefined", () => {
  it("remove undefined e mantém zero, false, string vazia e null", () => {
    const result = omitUndefined({
      category: undefined,
      amountCents: 0,
      enabled: false,
      note: "",
      intentionallyNull: null,
    });

    assert.deepEqual(result, {
      amountCents: 0,
      enabled: false,
      note: "",
      intentionallyNull: null,
    });
  });

  it("prepara receita e despesa sem categoria nem observação", () => {
    const common = { description: "Movimentação de teste", amountCents: 2500, date: "2026-11-10", createdAt: 1 };
    const income = omitUndefined({ ...common, type: "income", status: "received", category: undefined, note: undefined });
    const expense = omitUndefined({ ...common, type: "expense", status: "paid", category: undefined, note: undefined });

    assert.deepEqual(income, { ...common, type: "income", status: "received" });
    assert.deepEqual(expense, { ...common, type: "expense", status: "paid" });
  });

  it("mantém os campos opcionais preenchidos no cadastro completo", () => {
    const record = omitUndefined({ description: "Salário", amountCents: 500000, date: "2026-11-05", category: "Trabalho", note: "Pagamento mensal", createdAt: 1 });
    assert.equal(record.category, "Trabalho");
    assert.equal(record.note, "Pagamento mensal");
  });

  it("não envia undefined ao atualizar uma transação", () => {
    const patch = omitUndefined({ description: "Compra atualizada", amountCents: 0, category: undefined, note: undefined });
    assert.deepEqual(patch, { description: "Compra atualizada", amountCents: 0 });
  });
});
