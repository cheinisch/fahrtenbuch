import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { inspectVehicleShareInvitation, respondVehicleShareInvitation } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

export default function ShareInvitation() {
  const { accessToken }=useAuth();
  const { t, date }=useI18n();
  const [params]=useSearchParams();
  const token=params.get("token") || "";
  const [state,setState]=useState({loading:true,data:null,error:"",busy:false});

  useEffect(()=>{
    if(!token){setState({loading:false,data:null,error:t("shareInvitation.notFound"),busy:false});return;}
    inspectVehicleShareInvitation(accessToken,token)
      .then(data=>setState({loading:false,data,error:"",busy:false}))
      .catch(error=>setState({loading:false,data:null,error:error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message,busy:false}));
  },[accessToken,token]);

  async function respond(action){
    setState(s=>({...s,busy:true,error:""}));
    try{
      const result=await respondVehicleShareInvitation(accessToken,token,action);
      setState(s=>({...s,busy:false,data:{...s.data,status:result.status}}));
    }catch(error){
      setState(s=>({...s,busy:false,error:error.code === "SHARE_INVITATION_NOT_FOUND" ? t("shareInvitation.unknown") : error.message}));
    }
  }

  const d=state.data;
  return <div className="mx-auto max-w-2xl space-y-5">
    <div><p className="text-sm font-semibold text-fb-accent">{t("shareInvitation.section")}</p><h1 className="mt-1 text-3xl font-bold">{t("shareInvitation.title")}</h1></div>
    <div className="rounded-xl border border-fb-border bg-fb-main p-6">
      {state.loading ? <p className="text-fb-muted">{t("shareInvitation.title")} wird geprüft …</p> :
       state.error ? <div className="rounded-lg border border-fb-danger p-4 text-fb-danger">{state.error}</div> :
       d.expired || d.status==="expired" ? <>
         <h2 className="text-xl font-bold">{t("shareInvitation.expired")}</h2>
         <p className="mt-2 text-sm text-fb-muted">{t("shareInvitation.expiredHint")}</p>
       </> : d.status==="accepted" ? <>
         <h2 className="text-xl font-bold">{t("shareInvitation.section")} angenommen</h2>
         <p className="mt-2 text-sm text-fb-muted">{t("shareInvitation.acceptedHint",{vehicle:d.vehicleName})}</p>
         <Link to="/vehicles" className="mt-4 inline-block rounded-lg bg-fb-accent px-4 py-2 text-sm font-semibold text-fb-accent-text">{t("shareInvitation.toVehicles")}</Link>
       </> : d.status==="declined" ? <>
         <h2 className="text-xl font-bold">{t("shareInvitation.title")} abgelehnt</h2>
         <p className="mt-2 text-sm text-fb-muted">Es wurde keine {t("shareInvitation.section")} angelegt.</p>
       </> : !d.intendedForCurrentUser ? <>
         <h2 className="text-xl font-bold">{t("shareInvitation.title")} für einen anderen Benutzer</h2>
         <p className="mt-2 text-sm text-fb-muted">Bitte melde dich mit dem Benutzerkonto an, an dessen E-Mail-Adresse die {t("shareInvitation.title")} gesendet wurde.</p>
       </> : <>
         <h2 className="text-xl font-bold">{t("shareInvitation.request",{owner:d.ownerName})}</h2>
         <div className="mt-4 rounded-lg border border-fb-border bg-fb-surface p-4">
           <div className="text-xs uppercase tracking-wide text-fb-muted">{t("shareInvitation.vehicle")}</div><div className="mt-1 font-semibold">{d.vehicleName}</div>
           <div className="mt-3 text-xs text-fb-muted">{t("shareInvitation.validUntil",{date:date(d.expiresAt,{dateStyle:"medium",timeStyle:"short"})})}</div>
         </div>
         <p className="mt-4 text-sm text-fb-muted">Mit der Annahme kannst du das {t("shareInvitation.vehicle")} für deine eigenen Fahrten verwenden. {t("shareInvitation.vehicle")}stammdaten, Bluetooth-Konfiguration, Leasing-/Finanzierungsdaten und fahrzeugweite Statistiken bleiben dem Besitzer vorbehalten.</p>
         <div className="mt-5 flex gap-3">
           <button disabled={state.busy} onClick={()=>respond("accept")} className="rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text disabled:opacity-50">{t("vehicles.accept")}</button>
           <button disabled={state.busy} onClick={()=>respond("decline")} className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{t("vehicles.decline")}</button>
         </div>
       </>}
    </div>
  </div>;
}
