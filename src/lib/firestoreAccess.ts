import { collection, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export function assertUidOwnership(currentUid: string | undefined, requestedUid: string): void {
  if (!currentUid) throw new Error("É necessário entrar antes de acessar seus dados.");
  if (currentUid !== requestedUid) throw new Error("O usuário autenticado não corresponde ao caminho solicitado.");
}

export function assertAuthenticatedUser(uid: string): void {
  assertUidOwnership(auth.currentUser?.uid, uid);
}

export function userCollection(uid: string, collectionName: string) {
  assertAuthenticatedUser(uid);
  return collection(db, "users", uid, collectionName);
}

export function userDocument(uid: string, collectionName: string, documentId: string) {
  assertAuthenticatedUser(uid);
  return doc(db, "users", uid, collectionName, documentId);
}
