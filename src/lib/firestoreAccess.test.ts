import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertUidOwnership } from "./firestoreAccess";

describe("proteção dos caminhos por UID", () => {
  it("não permite chamadas antes da autenticação", () => {
    assert.throws(() => assertUidOwnership(undefined, "user-1"), /entrar antes/);
  });

  it("recusa um UID diferente do usuário autenticado", () => {
    assert.throws(() => assertUidOwnership("user-1", "user-2"), /não corresponde/);
  });

  it("permite o caminho do próprio usuário", () => {
    assert.doesNotThrow(() => assertUidOwnership("user-1", "user-1"));
  });
});
