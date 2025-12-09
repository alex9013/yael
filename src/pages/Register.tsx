import React, { useState } from "react";
import { api, setAuth } from "../api";
import { useNavigate, Link } from "react-router-dom";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/auth/register", {
        name,
        email,
        password,
      });
      // guardamos token igual que en login
      localStorage.setItem("token", data.token);
      setAuth(data.token);
      navigate("/dashboard"); // 👈 te lleva al dashboard después de registrarte
    } catch (err: any) {
      setError(err?.response?.data?.message || "Error al registrarse");
    }
  }

   return (
    <div className="register-container">
      <form onSubmit={onSubmit} className="register-box">
        <h2>Crear Cuenta</h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre completo"
        />
        <input
          type="email"
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

        <button type="submit">Registrarme</button>

        {error && <div className="error-message">{error}</div>}

        <div className="register-link">
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" style={{ color: "#4a81ff" }}>
            Inicia sesión
          </Link>
        </div>
      </form>
    </div>
  );
  
}
