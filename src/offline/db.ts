import { openDB, type IDBPDatabase } from "idb";


type DBSchema = {
  tasks: { key: string; value: any };
  outbox: { key: string; value: any };
  meta: { key: string; value: any };
};

let dbp: Promise<IDBPDatabase<DBSchema>>;

export function db() {
  if (!dbp) {
    dbp = openDB<DBSchema>("todo-pwa", 1, {
      upgrade(d) {
        d.createObjectStore("tasks", { keyPath: "_id" });
        d.createObjectStore("outbox", { keyPath: "_id" });
        d.createObjectStore("meta", { keyPath: "_id" });
      },
    });
  }
  return dbp;
}

// === Tareas cache local ===
export async function cacheTasks(list: any[]) {
  const tx = (await db()).transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  await store.clear();
  for (const t of list) await store.put(t);
  await tx.done;
}

export async function putTaskLocal(task: any) {
  const tx = (await db()).transaction("tasks", "readwrite");
  await tx.store.put(task);
  await tx.done;
}

export async function getAllTasksLocal() {
  return (await (await db()).getAll("tasks")) || [];
}

export async function removeTaskLocal(id: string) {
  await (await db()).delete("tasks", id);
}

// === Cola de sincronización (Outbox) ===
export type OutboxOp =
  | { _id: string; op: "create"; clienteId: string; data: any; ts: number } // 🚨 CAMBIADO DE 'id' a '_id'
  | { _id: string; op: "update"; serverId?: string; clienteId: string; data: any; ts: number } // 🚨 CAMBIADO DE 'id' a '_id'
  | { _id: string; op: "delete"; serverId?: string; clienteId?: string; ts: number }; // 🚨 CAMBIADO DE 'id' a '_id'

export async function queue(op: OutboxOp) {
  await (await db()).put("outbox", op);
}

export async function getOutbox() {
  return (await (await db()).getAll("outbox")) || [];
}

export async function clearOutbox() {
  const tx = (await db()).transaction("outbox", "readwrite");
  await tx.store.clear();
  await tx.done;
}

// === Mapeo de ID cliente-servidor ===
export async function setMapping(clienteId: string, serverId: string) {
  await (await db()).put("meta", { _id: clienteId, serverId });
}

export async function getMapping(clienteId: string) {
  return (await (await db()).get("meta", clienteId))?.serverId as string | undefined;
}
// Agregar al final de db.ts:
export async function removePendingOp(opId: string) {
  await (await db()).delete("outbox", opId);
}