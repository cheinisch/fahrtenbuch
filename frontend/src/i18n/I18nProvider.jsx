import { createContext,useContext,useEffect,useMemo,useState } from "react";
import de from "./locales/de.js";
import en from "./locales/en.js";
import { getPersonalSettings,getPublicLanguageSettings } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

const dictionaries={de,en};
const I18nContext=createContext(null);
function read(obj,key){return key.split(".").reduce((value,part)=>value?.[part],obj);}
export function I18nProvider({children}){
 const {accessToken,isAuthenticated}=useAuth();
 const [language,setLanguage]=useState("de");
 useEffect(()=>{let active=true;(async()=>{try{
   const global=await getPublicLanguageSettings(accessToken);
   let selected=global?.defaultLanguage || "de";
   if(isAuthenticated&&accessToken){const personal=await getPersonalSettings(accessToken);selected=personal?.settings?.language || selected;}
   if(active)setLanguage(dictionaries[selected]?selected:"de");
 }catch{if(active)setLanguage("de");}})();return()=>{active=false};},[accessToken,isAuthenticated]);
 useEffect(()=>{document.documentElement.lang=language;},[language]);
 const value=useMemo(()=>({language,setLanguage,t:(key,fallback)=>read(dictionaries[language],key)??read(de,key)??fallback??key}),[language]);
 return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(){const value=useContext(I18nContext);if(!value)throw new Error("useI18n requires I18nProvider");return value;}
