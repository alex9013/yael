import React, { useState } from "react";
import { api, setAuth } from "../api";
import { Link } from "react-router-dom"; // Añade esta importación

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    console.log("1. Intentando iniciar sesión...");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      console.log("2. Login exitoso. Redirigiendo...");
      localStorage.setItem("token", data.token);
      setAuth(data.token);
      location.href = "/Dashboard";
    } catch (err: any) {
      setError(err?.response?.data?.message || "Error al iniciar sesión");
    }
  }

  return (
    <div className="login-container">
      <form onSubmit={onSubmit} className="login-box">
        <h2>Iniciar Sesión</h2>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit">Entrar</button>
        {error && <p style={{ color: "red" }}>{error}</p>}
        
        {/* Añade este enlace al final del formulario */}
        <p style={{ marginTop: "10px", fontSize: "14px" }}>
          ¿No tienes cuenta?{" "}
          <Link to="/Register" style={{ color: "#1ebd33ff" }}>
            Regístrate aquí
          </Link>
        </p>
      </form>
    </div>
  );
}