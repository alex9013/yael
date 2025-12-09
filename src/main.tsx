// src/main.tsx (Ajuste Final)

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React from 'react';
import ReactDOM from 'react-dom/client';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Register from './pages/Register';
import ProtectedRoute from './routes/ProtectedRoute';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        
        {/* Rutas Públicas */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* 1. RUTA RAÍZ (`/`): Usa el ProtectedRoute. Esto es lo que cargará primero.
              Si hay token, carga Dashboard. Si no hay token, ProtectedRoute te envía a /login. */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        
        {/* 2. RUTA DASHBOARD ESPECÍFICA: Si alguien navega directamente a /dashboard */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />

        {/* 3. Catch-All (`*`): Captura cualquier URL no definida y redirige a la raíz (`/`). */}
        <Route path="*" element={<Navigate to="/" replace />} />
        
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
