// src/hooks/useOnlineStatus.ts (CORRECTO)
import { useEffect, useState } from "react";
// 🎯 Importar la función syncNow CORRECTA desde offline/sync
import { syncNow } from "../offline/sync"; 

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const updateStatus = async () => {
      const newStatus = navigator.onLine;
      setIsOnline(newStatus);

      if (newStatus) {
        console.log("Conexión recuperada. Iniciando sincronización...");
        // 1. Ejecuta la lógica de sincronización centralizada
        await syncNow(); 
        
        // 2. Dispara el evento global para que el Dashboard (y otros) se enteren
        window.dispatchEvent(new Event("sync-complete"));
        console.log("Sincronización terminada. Evento de refresco disparado.");
      }
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []); 

  return isOnline;
}