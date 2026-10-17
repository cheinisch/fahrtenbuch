import { createContext,useContext,useEffect,useMemo,useState } from "react";
import { dictionaries,setActiveLanguage,translateIn } from "./translate.js";
import { getPersonalSettings,getPublicLanguageSettings } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

const I18nContext=createContext(null);
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
 setActiveLanguage(language);
 const locale=language==="en"?"en-US":"de-DE";
 const value=useMemo(()=>({
   language,locale,setLanguage,
   t:(key,paramsOrFallback,fallback)=>translateIn(language,key,paramsOrFallback,fallback),
   number:(value,options)=>new Intl.NumberFormat(locale,options).format(value),
   date:(value,options)=>new Intl.DateTimeFormat(locale,options).format(value instanceof Date?value:new Date(value)),
 }),[language,locale]);
 return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(){const value=useContext(I18nContext);if(!value)throw new Error("useI18n requires I18nProvider");return value;}
