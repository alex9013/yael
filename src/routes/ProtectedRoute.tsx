// src/routes/ProtectedRoute.tsx (CORREGIDO)

import React from "react";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");

  // 💡 ¡CAMBIA to="/" por to="/login"!
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}