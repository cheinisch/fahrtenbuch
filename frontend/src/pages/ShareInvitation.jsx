import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { inspectVehicleShareInvitation, respondVehicleShareInvitation } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

export default function ShareInvitation() {
  const { accessToken }=useAuth();
  const [params]=useSearchParams();
  const token=params.get("token") || "";
  const [state,setState]=useState({loading:true,data:null,error:"",busy:false});

  useEffect(()=>{
    if(!token){setState({loading:false,data:null,error:"Die Einladung wurde nicht gefunden.",busy:false});return;}
    inspectVehicleShareInvitation(accessToken,token)
      .then(data=>setState({loading:false,data,error:"",busy:false}))
      .catch(error=>setState({loading:false,data:null,error:error.code === "SHARE_INVITATION_NOT_FOUND" ? "Link ist unbekannt." : error.message,busy:false}));
  },[accessToken,token]);

  async function respond(action){
    setState(s=>({...s,busy:true,error:""}));
    try{
      const result=await respondVehicleShareInvitation(accessToken,token,action);
      setState(s=>({...s,busy:false,data:{...s.data,status:result.status}}));
    }catch(error){
      setState(s=>({...s,busy:false,error:error.code === "SHARE_INVITATION_NOT_FOUND" ? "Link ist unbekannt." : error.message}));
    }
  }

  const d=state.data;
  return <div className="mx-auto max-w-2xl space-y-5">
    <div><p className="text-sm font-semibold text-fb-accent">Fahrzeugfreigabe</p><h1 className="mt-1 text-3xl font-bold">Einladung</h1></div>
    <div className="rounded-xl border border-fb-border bg-fb-main p-6">
      {state.loading ? <p className="text-fb-muted">Einladung wird geprüft …</p> :
       state.error ? <div className="rounded-lg border border-fb-danger p-4 text-fb-danger">{state.error}</div> :
       d.expired || d.status==="expired" ? <>
         <h2 className="text-xl font-bold">Link ist abgelaufen</h2>
         <p className="mt-2 text-sm text-fb-muted">Dieser Freigabelink ist nicht mehr gültig. Bitte den Fahrzeugbesitzer um einen neuen Link.</p>
       </> : d.status==="accepted" ? <>
         <h2 className="text-xl font-bold">Fahrzeugfreigabe angenommen</h2>
         <p className="mt-2 text-sm text-fb-muted">„{d.vehicleName}“ ist jetzt für dich freigegeben.</p>
         <Link to="/vehicles" className="mt-4 inline-block rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text">Zu den Fahrzeugen</Link>
       </> : d.status==="declined" ? <>
         <h2 className="text-xl font-bold">Einladung abgelehnt</h2>
         <p className="mt-2 text-sm text-fb-muted">Es wurde keine Fahrzeugfreigabe angelegt.</p>
       </> : !d.intendedForCurrentUser ? <>
         <h2 className="text-xl font-bold">Einladung für einen anderen Benutzer</h2>
         <p className="mt-2 text-sm text-fb-muted">Bitte melde dich mit dem Benutzerkonto an, an dessen E-Mail-Adresse die Einladung gesendet wurde.</p>
       </> : <>
         <h2 className="text-xl font-bold">{d.ownerName} möchte ein Fahrzeug mit dir teilen</h2>
         <div className="mt-4 rounded-lg border border-fb-border bg-fb-surface p-4">
           <div className="text-xs uppercase tracking-wide text-fb-muted">Fahrzeug</div><div className="mt-1 font-semibold">{d.vehicleName}</div>
           <div className="mt-3 text-xs text-fb-muted">Gültig bis {new Date(d.expiresAt).toLocaleString("de-DE")}</div>
         </div>
         <p className="mt-4 text-sm text-fb-muted">Mit der Annahme kannst du das Fahrzeug für deine eigenen Fahrten verwenden. Fahrzeugstammdaten, Bluetooth-Konfiguration, Leasing-/Finanzierungsdaten und fahrzeugweite Statistiken bleiben dem Besitzer vorbehalten.</p>
         <div className="mt-5 flex gap-3">
           <button disabled={state.busy} onClick={()=>respond("accept")} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-50">Annehmen</button>
           <button disabled={state.busy} onClick={()=>respond("decline")} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Ablehnen</button>
         </div>
       </>}
    </div>
  </div>;
}
