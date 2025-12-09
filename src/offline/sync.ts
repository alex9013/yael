
// src/offline/sync.ts

import { api } from "../api";
import {
  getOutbox,
  setMapping,
  getMapping,
  putTaskLocal,
  removeTaskLocal,
  removePendingOp,
} from "./db";

function normalizeTask(x: any) {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
  };
}

export async function syncNow() {
  if (!navigator.onLine) {
    console.log("[SYNC] Sin conexión, saltando sincronización");
    return;
  }

  const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts);
  if (!ops.length) {
    console.log("[SYNC] No hay operaciones pendientes");
    return;
  }

  console.log(`[SYNC] 🔄 Sincronizando ${ops.length} operaciones...`);

  // 🎯 ORDEN CRÍTICO: CREATE → UPDATE → DELETE
  const creates = ops.filter((op) => op.op === "create");
  const updates = ops.filter((op) => op.op === "update");
  const deletes = ops.filter((op) => op.op === "delete");

  // ============================================
  // 1️⃣ PROCESAR CREATEs PRIMERO
  // ============================================
  for (const op of creates) {
    try {
      console.log(`[SYNC-CREATE] Procesando: ${op.clienteId}`);

      const res = await api.post("/tasks", {
        title: op.data.title,
        description: op.data.description,
        status: op.data.status,
      });

      const serverTask = normalizeTask(res.data?.task ?? res.data);
      const serverId = serverTask._id;

      if (!serverId || serverId === op.clienteId) {
        throw new Error("Error: No se obtuvo un serverId válido");
      }

      console.log(`[SYNC-CREATE] ✅ Mapeando ${op.clienteId} → ${serverId}`);
      
      // Guardar mapping
      await setMapping(op.clienteId, serverId);

      // Reemplazar en caché local
      await removeTaskLocal(op.clienteId);
      await putTaskLocal(serverTask);

      // Remover de la cola
      await removePendingOp(op._id);

      console.log(`[SYNC-CREATE] ✅ Completado: ${serverId}`);
    } catch (err) {
      console.error(`[SYNC-CREATE] ❌ Falló ${op.clienteId}:`, err);
      return; // Detener sincronización si falla
    }
  }

  // ============================================
  // 2️⃣ PROCESAR UPDATEs
  // ============================================
  for (const op of updates) {
    try {
      console.log(`[SYNC-UPDATE] Procesando: ${op.clienteId}`);

      // Obtener el serverId del mapping
      const serverId = await getMapping(op.clienteId);

      if (!serverId) {
        console.warn(`[SYNC-UPDATE] ⚠️ No hay mapping para ${op.clienteId}, saltando`);
        await removePendingOp(op._id);
        continue;
      }

      await api.put(`/tasks/${serverId}`, {
        title: op.data.title,
        description: op.data.description,
        status: op.data.status,
      });

      console.log(`[SYNC-UPDATE] ✅ Completado: ${serverId}`);
      
      // Actualizar caché local
      await putTaskLocal({ ...op.data, _id: serverId });
      
      // Remover de la cola
      await removePendingOp(op._id);
    } catch (err) {
      console.error(`[SYNC-UPDATE] ❌ Falló ${op.clienteId}:`, err);
      return; // Detener sincronización si falla
    }
  }

  // ============================================
  // 3️⃣ PROCESAR DELETEs AL FINAL
  // ============================================
  for (const op of deletes) {
    try {
      console.log(`[SYNC-DELETE] Procesando: ${op.clienteId || op.serverId}`);

      // Intentar obtener el serverId
      let serverId = op.serverId;
      
      if (!serverId && op.clienteId) {
        serverId = await getMapping(op.clienteId);
      }

      if (!serverId) {
        console.warn(`[SYNC-DELETE] ⚠️ No se encontró serverId, removiendo de cola`);
        await removePendingOp(op._id);
        continue;
      }

      await api.delete(`/tasks/${serverId}`);

      console.log(`[SYNC-DELETE] ✅ Completado: ${serverId}`);
      
      // Remover de caché local
      await removeTaskLocal(serverId);
      
      // Remover de la cola
      await removePendingOp(op._id);
    } catch (err) {
      console.error(`[SYNC-DELETE] ❌ Falló:`, err);
      return; // Detener sincronización si falla
    }
  }

  console.log("✅ [SYNC] Sincronización completada exitosamente");
  
  // Disparar evento para recargar tareas en el Dashboard
  window.dispatchEvent(new Event("sync-complete"));
}