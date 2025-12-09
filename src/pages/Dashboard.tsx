import { useEffect, useMemo, useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  setMapping,
  getMapping,
} from "../offline/db";

type Task = {
  _id: string;
  title: string;
  description?: string; // keep the same misspelling to match your DB
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
};

function normalizeTask(x: any): Task {
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
    deleted: !!x?.deleted,
  };
}

function isSyncPending(id: string): boolean {
    // Los IDs de MongoDB suelen ser de 24 caracteres hexadecimales.
    // Los IDs temporales (UUIDs) son de 36 caracteres.
    return id.length > 30; 
}


export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [statusNew, setStatusNew] = useState<Task["status"]>("Pendiente");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");


  // editing inline states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDesc, setEditingDesc] = useState("");
  const [editingStatus, setEditingStatus] = useState<Task["status"]>("Pendiente");

  const isOnline = useOnlineStatus();
  const navigate = useNavigate();

  useEffect(() => {
  setAuth(localStorage.getItem("token"));
  loadTasks();
  
  // 🎯 NUEVA LÓGICA: Escuchar el evento personalizado de sincronización
  window.addEventListener("sync-complete", loadTasks);
  
  return () => {
    window.removeEventListener("sync-complete", loadTasks);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

 async function loadTasks() {
    setLoading(true);
    try {
        if (navigator.onLine) {
            // 🚨 Nuevo: Intentamos obtener del servidor
            try { 
                const { data } = await api.get("/tasks");
                
                const raw = Array.isArray(data?.items)
                    ? data.items
                    : Array.isArray(data)
                    ? data
                    : [];
                
                const list = raw.map(normalizeTask);
                setTasks(list);
                await cacheTasks(list);

            } catch (err) {
                // 🚨 Fallback: Si el servidor falla, cargamos desde la caché local 
                // para evitar mostrar una lista vacía.
                console.warn("Fallo al obtener tareas del servidor, cargando desde caché local.", err);
                const cached = await getAllTasksLocal();
                setTasks(cached);
            }
        } else {
            // Modo OFFLINE: siempre carga desde caché
            const cached = await getAllTasksLocal();
            setTasks(cached);
        }
    } finally {
        setLoading(false);
    }
}
  

  

  

  // add
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const newTask: Task = {
      _id: clienteId, // Usa clienteId temporalmente
      title: t,
      description: desc.trim() || "",
      status: statusNew,
      clienteId,
      createdAt: new Date().toISOString(),
    };

    // Mostrar inmediatamente y guardar en caché local (con clienteId)
    setTasks((prev) => [newTask, ...prev]);
    await putTaskLocal(newTask);
    setTitle("");
    setDesc("");
    setStatusNew("Pendiente");

    if (navigator.onLine) {
      try {
        // 1. Enviar al servidor
        const { data } = await api.post("/tasks", {
          title: newTask.title,
          description: newTask.description,
          status: newTask.status,
        });
        const serverTask = normalizeTask(data?.task ?? data);
        const serverId = serverTask._id;
        
        // 2. Guardar mapeo (clienteId -> serverId)
        await setMapping(clienteId, serverId);
        
        // 3. Reemplazar en la UI:
        setTasks((prev) => {
            const listWithoutTemp = prev.filter((t) => t._id !== clienteId);
            // Reinsertar la tarea permanente al inicio
            return [serverTask, ...listWithoutTemp]; 
        });
        
        // 4. Reemplazar en la caché local:
        await removeTaskLocal(clienteId);
        await putTaskLocal(serverTask);


      } catch (err) {
        console.warn("POST error, queueing", err);
        // Si falla el POST (ej. error 500, servidor caído), la tarea se encola
        await queue({
          _id: crypto.randomUUID(),
          op: "create",
          clienteId,
          data: newTask,
          ts: Date.now(),
        });
      }
    } else {
      // 5. Si está offline, solo se encola
      await queue({
        _id: crypto.randomUUID(),
        op: "create",
        clienteId,
        data: newTask,
        ts: Date.now(),
      });
    }
  }

  // safe change status -> importante: si no hay mapping hacemos queue
  async function changeStatus(task: Task, newStatus: Task["status"]) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    const mappingId = await getMapping(task.clienteId ?? "");
    const id = mappingId ?? task._id;

    // si id parece no válido o es clienteId temporal y no hay mapping -> push a queue
    if (!mappingId && (!id || id === "undefined")) {
      // push update to outbox so server will get it when create is synced
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: task.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
      return;
    }

    // si tenemos id (sea mapping o mismo _id), intentamos PUT
    if (navigator.onLine) {
      try {
        await api.put(`/tasks/${id}`, {
          title: updated.title,
          description: updated.description,
          status: updated.status,
        });
      } catch (err) {
        console.warn("PUT status failed, queueing", err);
        await queue({
          _id: crypto.randomUUID(),
          op: "update",
          clienteId: task.clienteId ?? "",
          data: updated,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: task.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
    }
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === "Completada" ? "Pendiente" : "Completada";
    await changeStatus(task, newStatus);
  }

  // edit inline
  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDesc(task.description ?? "");
    setEditingStatus(task.status);
    const el = document.getElementById(`task-${task._id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;
    const before = tasks.find((t) => t._id === taskId);
    if (!before) return;

    const updated: Task = {
      ...before,
      title: newTitle,
      description: editingDesc.trim(),
      status: editingStatus,
    };

    setTasks((prev) => prev.map((t) => (t._id === taskId ? updated : t)));
    setEditingId(null);
    await putTaskLocal(updated);

    const mappingId = await getMapping(updated.clienteId ?? "");
    const id = mappingId ?? updated._id;

    if (!mappingId && (!id || id === "undefined")) {
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: updated.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
      return;
    }

    if (navigator.onLine) {
      try {
        await api.put(`/tasks/${id}`, {
          title: updated.title,
          description: updated.description,
          status: updated.status,
        });
      } catch (err) {
        console.warn("PUT edit failed, queueing", err);
        await queue({
          _id: crypto.randomUUID(),
          op: "update",
          clienteId: updated.clienteId ?? "",
          data: updated,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: updated.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
    }
  }

  function cancelEdit() {
    setEditingId(null);
  }

  // remove
  async function removeTask(taskId: string) {
    const task = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    const mappingId = await getMapping(task?.clienteId ?? "");
    const id = mappingId ?? taskId;

    if (!mappingId && (!id || id === "undefined")) {
      await queue({
        _id: crypto.randomUUID(),
        op: "delete",
        clienteId: task?.clienteId ?? "",
        ts: Date.now(),
      });
      return;
    }

    if (navigator.onLine) {
      try {
        await api.delete(`/tasks/${id}`);
      } catch (err) {
        console.warn("DELETE failed, queueing", err);
        await queue({
          _id: crypto.randomUUID(),
          op: "delete",
          clienteId: task?.clienteId ?? "",
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        _id: crypto.randomUUID(),
        op: "delete",
        clienteId: task?.clienteId ?? "",
        ts: Date.now(),
      });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    navigate("/login", { replace: true });
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  
  return (
    <div className="wrap">
      <header className="topbar" role="banner">
        <h1>Mis Tareas</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
        </div>

        <div className={`estado-conexion ${isOnline ? "online" : "offline"}`}>
          {isOnline ? "ON 🟢 " : "OFF 🔴 "}
        </div>

       <button className="btn danger" onClick={logout}>
  <FiLogOut size={18} />
</button>
      </header>

      <main>
        {/* CREATE SECTION (separada) */}
        <section className="create-section" style={{ marginTop: 16 }}>
          <form className="add add-extended" onSubmit={addTask}>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título de la tarea…"
                aria-label="Título"
                style={{ minWidth: 180 }}
              />
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Descripción opcional…"
                className="add-desc"
                aria-label="Descripción"
              />
              <select
                value={statusNew}
                onChange={(e) => setStatusNew(e.target.value as Task["status"])}
                className="status-select"
                aria-label="Estado inicial"
              >
                <option value="Pendiente">Pendiente</option>
                <option value="En Progreso">En Progreso</option>
                <option value="Completada">Completada</option>
              </select>

              <button className="btn" style={{ alignSelf: "center" }}>
                AGREGAR
              </button>
            </div>
          </form>
        </section>
{/* SEARCH + FILTERS (section separada) */}
<section
  className="controls-section"
  style={{
    marginTop: 14,
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  }}
>
  <div
    className="search-box"
    style={{ display: "flex", gap: 8, alignItems: "center" }}
  >
    <input
      className="search"
      placeholder="Buscar…"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      style={{ minWidth: 220 }}
    />
  </div>
</section>

          <div className="filters-section" style={{ display: "flex", gap: 8 }}>
            <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")} type="button">
              Todas
            </button>
            <button className={filter === "active" ? "chip active" : "chip"} onClick={() => setFilter("active")} type="button">
              Activas
            </button>
            <button className={filter === "completed" ? "chip active" : "chip"} onClick={() => setFilter("completed")} type="button">
              Hechas
            </button>
          </div>
        

        {/* LIST */}
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <section className="tasks-list" style={{ marginTop: 12 }}>
            <ul className="list" style={{ display: "grid", gap: 12 }}>
              {filtered.map((t, idx) => {
                const isEditing = editingId === t._id;
                return (
                  <li
                    id={`task-${t._id}`}
                    key={`${t._id || t.title}-${idx}`}
                    className={`item ${t.status === "Completada" ? "done" : ""} ${isEditing ? "expanded" : ""}`}
                    style={{ animation: "cardIn 300ms ease" }}
                  >
                    <div style={{ display: "flex", gap: 12, width: "100%" }}>
                      <div style={{ width: 42, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                        <div className="task-number" aria-hidden>
                          {idx + 1}
                        </div>
                        <label className="check">
                          <input type="checkbox" checked={t.status === "Completada"} onChange={() => toggleTask(t)} />
                        </label>
                      </div>

                      <div style={{ flex: 1 }}>
                        {!isEditing ? (
                          <>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span className="title" onDoubleClick={() => startEdit(t)} style={{ fontWeight: 600 }}>
                                  {t.title || "(sin título)"}
                                </span>
{/* 🚨 ÍCONO DE NUBE PENDIENTE 🚨 */}
                                {isSyncPending(t._id) && (
                                  <span className="sync-pending-icon" title="Pendiente de sincronizar al servidor">
                                    🕒

                                  </span>
                                )}
                                {/* ... el resto del código ... */}
                                <span className="muted created" style={{ marginLeft: 8, fontSize: 12, color: "#9aa" }}>
                                  {/* optional createdAt display */}
                                </span>
                              </div>

                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <select className="task-status" value={t.status} onChange={(e) => changeStatus(t, e.target.value as Task["status"])}>
                                  <option value="Pendiente">Pendiente</option>
                                  <option value="En Progreso">En Progreso</option>
                                  <option value="Completada">Completada</option>
                                </select>

                                <div style={{ display: "flex", gap: 6 }}>
                                  <button className="action-btn" title="Editar" onClick={() => startEdit(t)}>Editar</button>
                                  <button className="action-btn" title="Eliminar" onClick={() => removeTask(t._id)}>Borrar</button>
                                </div>
                              </div>
                            </div>

                            {t.description ? <p className="task-desc" style={{ marginTop: 8 }}>{t.description}</p> : null}
                          </>
                        ) : (
                          <div className="edit-panel" style={{ marginTop: 6 }}>
                            <input className="edit" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit(t._id)} autoFocus />
                            <textarea className="edit-desc" value={editingDesc} onChange={(e) => setEditingDesc(e.target.value)} placeholder="Descripción..." />
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                              <select className="task-status" value={editingStatus} onChange={(e) => setEditingStatus(e.target.value as Task["status"])}>
                                <option value="Pendiente">Pendiente</option>
                                <option value="En Progreso">En Progreso</option>
                                <option value="Completada">Completada</option>
                              </select>
                              <button className="btn" onClick={() => saveEdit(t._id)} type="button">Guardar</button>
                              <button className="btn danger" onClick={() => cancelEdit()} type="button">Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
