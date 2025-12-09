import { useEffect, useMemo, useState } from "react";
import { FiLogOut, FiClock, FiPlay, FiPause, FiStopCircle } from "react-icons/fi";
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
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  // 🆕 NUEVOS CAMPOS PARA ESTIMACIÓN DE TIEMPO
  estimatedTime?: number; // en minutos
  actualTime?: number; // en minutos
  isTracking?: boolean;
  startTime?: number; // timestamp cuando inicia el tracking
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
    // 🆕 Normalizar campos de tiempo
    estimatedTime: x?.estimatedTime ?? 0,
    actualTime: x?.actualTime ?? 0,
    isTracking: !!x?.isTracking,
    startTime: x?.startTime ?? null,
  };
}

function isSyncPending(id: string): boolean {
  return id.length > 30;
}

// 🆕 UTILIDAD: Formatear minutos a formato legible
function formatTime(minutes: number): string {
  if (!minutes || minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

// 🆕 UTILIDAD: Calcular varianza porcentual
function getVariance(estimated: number, actual: number): number {
  if (!estimated || actual === 0) return 0;
  return Math.round(((actual - estimated) / estimated) * 100);
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [statusNew, setStatusNew] = useState<Task["status"]>("Pendiente");
  
  // 🆕 Estados para estimación de tiempo en nuevo task
  const [estimatedHours, setEstimatedHours] = useState(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  // editing inline states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDesc, setEditingDesc] = useState("");
  const [editingStatus, setEditingStatus] = useState<Task["status"]>("Pendiente");
  
  // 🆕 Estados para editar tiempo estimado
  const [editingEstHours, setEditingEstHours] = useState(0);
  const [editingEstMinutes, setEditingEstMinutes] = useState(0);

  const isOnline = useOnlineStatus();
  const navigate = useNavigate();

  // 🆕 Timer para actualizar el tiempo de las tareas en tracking
  useEffect(() => {
    const interval = setInterval(() => {
      setTasks((prev) =>
        prev.map((task) => {
          if (task.isTracking && task.startTime) {
            const elapsed = Math.floor((Date.now() - task.startTime) / 60000);
            return {
              ...task,
              actualTime: (task.actualTime ?? 0) + elapsed,
              startTime: Date.now(), // reset startTime
            };
          }
          return task;
        })
      );
    }, 60000); // cada minuto

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    loadTasks();
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
          console.warn("Fallo al obtener tareas del servidor, cargando desde caché local.", err);
          const cached = await getAllTasksLocal();
          setTasks(cached);
        }
      } else {
        const cached = await getAllTasksLocal();
        setTasks(cached);
      }
    } finally {
      setLoading(false);
    }
  }

  // 🆕 FUNCIÓN: Toggle tracking (play/pause)
  async function toggleTracking(task: Task) {
    const updated = {
      ...task,
      isTracking: !task.isTracking,
      startTime: !task.isTracking ? Date.now() : null,
    };

    // Si se está pausando, calcular tiempo transcurrido
    if (task.isTracking && task.startTime) {
      const elapsed = Math.floor((Date.now() - task.startTime) / 60000);
      updated.actualTime = (task.actualTime ?? 0) + elapsed;
    }

    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);
    await syncTaskToServer(updated);
  }

  // 🆕 FUNCIÓN: Completar tarea (detener tracking si está activo)
  async function completeTask(task: Task) {
    let finalTime = task.actualTime ?? 0;
    
    if (task.isTracking && task.startTime) {
      const elapsed = Math.floor((Date.now() - task.startTime) / 60000);
      finalTime = (task.actualTime ?? 0) + elapsed;
    }

    const updated = {
      ...task,
      status: "Completada" as Task["status"],
      isTracking: false,
      actualTime: finalTime,
      startTime: null,
    };

    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);
    await syncTaskToServer(updated);
  }

  // 🆕 FUNCIÓN AUXILIAR: Sincronizar tarea al servidor
  async function syncTaskToServer(task: Task) {
    const mappingId = await getMapping(task.clienteId ?? "");
    const id = mappingId ?? task._id;

    if (!mappingId && (!id || id === "undefined")) {
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: task.clienteId ?? "",
        data: task,
        ts: Date.now(),
      });
      return;
    }

    if (navigator.onLine) {
      try {
        await api.put(`/tasks/${id}`, {
          title: task.title,
          description: task.description,
          status: task.status,
          estimatedTime: task.estimatedTime,
          actualTime: task.actualTime,
          isTracking: task.isTracking,
          startTime: task.startTime,
        });
      } catch (err) {
        console.warn("PUT failed, queueing", err);
        await queue({
          _id: crypto.randomUUID(),
          op: "update",
          clienteId: task.clienteId ?? "",
          data: task,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        _id: crypto.randomUUID(),
        op: "update",
        clienteId: task.clienteId ?? "",
        data: task,
        ts: Date.now(),
      });
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const totalMinutes = estimatedHours * 60 + estimatedMinutes;
    
    const newTask: Task = {
      _id: clienteId,
      title: t,
      description: desc.trim() || "",
      status: statusNew,
      clienteId,
      createdAt: new Date().toISOString(),
      // 🆕 Agregar campos de tiempo
      estimatedTime: totalMinutes,
      actualTime: 0,
      isTracking: false,
      startTime: null,
    };

    setTasks((prev) => [newTask, ...prev]);
    await putTaskLocal(newTask);
    setTitle("");
    setDesc("");
    setStatusNew("Pendiente");
    setEstimatedHours(0);
    setEstimatedMinutes(30);

    if (navigator.onLine) {
      try {
        const { data } = await api.post("/tasks", {
          title: newTask.title,
          description: newTask.description,
          status: newTask.status,
          estimatedTime: newTask.estimatedTime,
          actualTime: newTask.actualTime,
        });
        const serverTask = normalizeTask(data?.task ?? data);
        const serverId = serverTask._id;
        await setMapping(clienteId, serverId);
        setTasks((prev) => {
          const listWithoutTemp = prev.filter((t) => t._id !== clienteId);
          return [serverTask, ...listWithoutTemp];
        });
        await removeTaskLocal(clienteId);
        await putTaskLocal(serverTask);
      } catch (err) {
        console.warn("POST error, queueing", err);
        await queue({
          _id: crypto.randomUUID(),
          op: "create",
          clienteId,
          data: newTask,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        _id: crypto.randomUUID(),
        op: "create",
        clienteId,
        data: newTask,
        ts: Date.now(),
      });
    }
  }

  async function changeStatus(task: Task, newStatus: Task["status"]) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);
    await syncTaskToServer(updated);
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === "Completada" ? "Pendiente" : "Completada";
    await changeStatus(task, newStatus);
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDesc(task.description ?? "");
    setEditingStatus(task.status);
    // 🆕 Cargar tiempo estimado para edición
    setEditingEstHours(Math.floor((task.estimatedTime ?? 0) / 60));
    setEditingEstMinutes((task.estimatedTime ?? 0) % 60);
    const el = document.getElementById(`task-${task._id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;
    const before = tasks.find((t) => t._id === taskId);
    if (!before) return;

    const totalMinutes = editingEstHours * 60 + editingEstMinutes;

    const updated: Task = {
      ...before,
      title: newTitle,
      description: editingDesc.trim(),
      status: editingStatus,
      estimatedTime: totalMinutes, // 🆕 Actualizar tiempo estimado
    };

    setTasks((prev) => prev.map((t) => (t._id === taskId ? updated : t)));
    setEditingId(null);
    await putTaskLocal(updated);
    await syncTaskToServer(updated);
  }

  function cancelEdit() {
    setEditingId(null);
  }

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
    
    // 🆕 Estadísticas de tiempo
    const completedTasks = tasks.filter((t) => t.status === "Completada");
    const totalEstimated = completedTasks.reduce((sum, t) => sum + (t.estimatedTime ?? 0), 0);
    const totalActual = completedTasks.reduce((sum, t) => sum + (t.actualTime ?? 0), 0);
    
    return { 
      total, 
      done, 
      pending: total - done,
      totalEstimated,
      totalActual,
    };
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
          {/* 🆕 Estadísticas de tiempo */}
          {stats.done > 0 && (
            <>
              <span title="Tiempo estimado total">⏱️ Est: {formatTime(stats.totalEstimated)}</span>
              <span title="Tiempo real total">⏰ Real: {formatTime(stats.totalActual)}</span>
            </>
          )}
        </div>

        <div className={`estado-conexion ${isOnline ? "online" : "offline"}`}>
          {isOnline ? "ON 🟢 " : "OFF 🔴 "}
        </div>

        <button className="btn danger" onClick={logout}>
          <FiLogOut size={18} />
        </button>
      </header>

      <main>
        {/* CREATE SECTION */}
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
              
              {/* 🆕 CAMPOS DE TIEMPO ESTIMADO */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <FiClock size={16} style={{ color: "#666" }} />
                <input
                  type="number"
                  min="0"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(parseInt(e.target.value) || 0)}
                  placeholder="h"
                  style={{ width: 50 }}
                  title="Horas estimadas"
                />
                <span style={{ color: "#666" }}>h</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(parseInt(e.target.value) || 0)}
                  placeholder="m"
                  style={{ width: 50 }}
                  title="Minutos estimados"
                />
                <span style={{ color: "#666" }}>m</span>
              </div>

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

        {/* SEARCH + FILTERS */}
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
          <div className="search-box" style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                const variance = getVariance(t.estimatedTime ?? 0, t.actualTime ?? 0);
                const isOvertime = (t.actualTime ?? 0) > (t.estimatedTime ?? 0);

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
                                {isSyncPending(t._id) && (
                                  <span className="sync-pending-icon" title="Pendiente de sincronizar al servidor">
                                    🕒
                                  </span>
                                )}
                              </div>

                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <select className="task-status" value={t.status} onChange={(e) => changeStatus(t, e.target.value as Task["status"])}>
                                  <option value="Pendiente">Pendiente</option>
                                  <option value="En Progreso">En Progreso</option>
                                  <option value="Completada">Completada</option>
                                </select>

                                <div style={{ display: "flex", gap: 6 }}>
                                  <button className="action-btn" title="Editar" onClick={() => startEdit(t)}>
                                    Editar
                                  </button>
                                  <button className="action-btn" title="Eliminar" onClick={() => removeTask(t._id)}>
                                    Borrar
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* 🆕 INFORMACIÓN DE TIEMPO */}
                            {(t.estimatedTime ?? 0) > 0 && (
                              <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
                                <span style={{ color: "#0066cc" }}>
                                  ⏱️ Est: {formatTime(t.estimatedTime ?? 0)}
                                </span>
                                <span style={{ color: t.isTracking ? "#22c55e" : "#666" }}>
                                  ⏰ Real: {formatTime(t.actualTime ?? 0)}
                                </span>
                                
                                {t.status === "Completada" && (t.actualTime ?? 0) > 0 && (
                                  <span style={{ color: isOvertime ? "#dc2626" : "#22c55e", fontWeight: 600 }}>
                                    {variance > 0 ? "+" : ""}{variance}%
                                  </span>
                                )}

                                {/* 🆕 BOTONES DE TRACKING */}
                                {t.status !== "Completada" && (
                                  <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                                    <button
                                      onClick={() => toggleTracking(t)}
                                      className="action-btn"
                                      style={{
                                        backgroundColor: t.isTracking ? "#fbbf24" : "#22c55e",
                                        color: "white",
                                        border: "none",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                      title={t.isTracking ? "Pausar" : "Iniciar"}
                                    >
                                      {t.isTracking ? <FiPause size={14} /> : <FiPlay size={14} />}
                                      {t.isTracking ? "Pausar" : "Iniciar"}
                                    </button>
                                    
                                    {t.isTracking && (
                                      <button
                                        onClick={() => completeTask(t)}
                                        className="action-btn"
                                        style={{
                                          backgroundColor: "#0066cc",
                                          color: "white",
                                          border: "none",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 4,
                                        }}
                                        title="Completar"
                                      >
                                        <FiStopCircle size={14} />
                                        Completar
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 🆕 BARRA DE PROGRESO */}
                            {(t.estimatedTime ?? 0) > 0 && (
                              <div style={{ marginTop: 6, width: "100%", backgroundColor: "#e5e7eb", borderRadius: 4, height: 6, overflow: "hidden" }}>
                                <div
                                  style={{
                                    height: "100%",
                                    backgroundColor: (t.actualTime ?? 0) > (t.estimatedTime ?? 0) ? "#dc2626" : "#22c55e",
                                    width: `${Math.min(((t.actualTime ?? 0) / (t.estimatedTime ?? 1)) * 100, 100)}%`,
                                    transition: "width 0.3s ease",
                                  }}
                                />
                              </div>
                            )}

                            {t.description ? <p className="task-desc" style={{ marginTop: 8 }}>{t.description}</p> : null}
                          </>
                        ) : (
                          <div className="edit-panel" style={{ marginTop: 6 }}>
                            <input className="edit" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit(t._id)} autoFocus />
                            <textarea className="edit-desc" value={editingDesc} onChange={(e) => setEditingDesc(e.target.value)} placeholder="Descripción..." />
                            
                            {/* 🆕 EDITAR TIEMPO ESTIMADO */}
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                              <FiClock size={16} />
                              <span style={{ fontSize: 13 }}>Estimado:</span>
                              <input
                                type="number"
                                min="0"
                                value={editingEstHours}
                                onChange={(e) => setEditingEstHours(parseInt(e.target.value) || 0)}
                                style={{ width: 50 }}
                              />
                              <span>h</span>
                              <input
                                type="number"
                                min="0"
                                max="59"
                                value={editingEstMinutes}
                                onChange={(e) => setEditingEstMinutes(parseInt(e.target.value) || 0)}
                                style={{ width: 50 }}
                              />
                              <span>m</span>
                            </div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                              <select className="task-status" value={editingStatus} onChange={(e) => setEditingStatus(e.target.value as Task["status"])}>
                                <option value="Pendiente">Pendiente</option>
                                <option value="En Progreso">En Progreso</option>
                                <option value="Completada">Completada</option>
                              </select>
                              <button className="btn" onClick={() => saveEdit(t._id)} type="button">
                                Guardar
                              </button>
                              <button className="btn danger" onClick={() => cancelEdit()} type="button">
                                Cancelar
                              </button>
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
