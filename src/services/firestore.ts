// src/services/firestore.ts
import { db, timestamp } from './firebase';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  FieldValue,
} from 'firebase/firestore';

export type PageDef = {
  id: number;
  type: 'problem' | 'concept';
  name: string;
  path: string;
};

// ---------- Pages Collection ----------

export async function addPageToDB(userId: string, page: PageDef) {
  const ref = doc(db, "users", userId, "pages", String(page.id));
  await setDoc(ref, {
    ...page,
    createdAt: timestamp(),
  });
}

export async function deletePageFromDB(userId: string, id: number) {
  const ref = doc(db, "users", userId, "pages", String(id));
  await deleteDoc(ref);
}

export async function getAllPages(userId: string): Promise<PageDef[]> {
  const ref = collection(db, "users", userId, "pages");
  const snapshot = await getDocs(ref);
  return snapshot.docs.map(doc => doc.data() as PageDef);
}

// ---------- Components Subcollections ----------

export async function addComponentToPage(
  userId: string,
  pageId: number,
  componentData: Record<string, unknown>
) {
  const componentsRef = collection(db, "users", userId, "pages", String(pageId), "components");
  await addDoc(componentsRef, {
    ...componentData,
    createdAt: serverTimestamp(),
  });
}

export async function getComponentsOfPage(
  userId: string,
  pageId: number
): Promise<unknown[]> {
  const snapshot = await getDocs(
    collection(db, "users", userId, "pages", String(pageId), "components")
  );
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function updateComponent(
  userId: string,
  pageId: number,
  componentId: string,
  updatedData: Record<string, FieldValue>
) {
  const ref = doc(
    db,
    "users",
    userId,
    "pages",
    String(pageId),
    "components",
    componentId
  );
  await updateDoc(ref, updatedData);
}

export async function deleteComponent(
  userId: string,
  pageId: number,
  componentId: string
) {
  const ref = doc(
    db,
    "users",
    userId,
    "pages",
    String(pageId),
    "components",
    componentId
  );
  await deleteDoc(ref);
}

export async function deletePageAndComponents(userId: string, pageId: number) {
  const pagePath = `users/${userId}/pages/${pageId}`;
  const componentsRef = collection(db, pagePath, "components");

  // Step 1: delete all components
  const snapshot = await getDocs(componentsRef);
  const deletePromises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
  await Promise.all(deletePromises);

  // Step 2: delete the page itself
  await deleteDoc(doc(db, "users", userId, "pages", String(pageId)));
}
