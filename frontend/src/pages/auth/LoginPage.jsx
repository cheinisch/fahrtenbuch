import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../../api/authApi.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await login({ email, password });
      localStorage.setItem("accessToken", data.accessToken);
      navigate("/");
    } catch {
      setError("Anmeldung fehlgeschlagen");
    }
  }

  return (
    <main className="content" style={{maxWidth: 460}}>
      <form className="card" onSubmit={submit}>
        <h1>Anmelden</h1>
        <label>E-Mail<input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" required /></label>
        <label>Passwort<input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" required /></label>
        {error && <p>{error}</p>}
        <button>Anmelden</button>
      </form>
    </main>
  );
}
