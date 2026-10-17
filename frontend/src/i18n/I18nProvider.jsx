import { createContext,useContext,useEffect,useMemo,useState } from "react";
import { parse as parseJsonc } from "jsonc-parser";
import deLegacy from "./locales/de.js";
import enLegacy from "./locales/en.js";
import deJson from "./locales/de/translation.json?raw";
import enJson from "./locales/en/translation.json?raw";
import { getPersonalSettings,getPublicLanguageSettings } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

// Übersetzungsdateien sind JSONC (Kommentare erlaubt) – daher ?raw + jsonc-parser
// statt Vites JSON-Import. Während der Migration ergänzen sie die alten JS-Dateien.
function loadJsonc(source,file){
 const errors=[];
 const data=parseJsonc(source,errors,{allowTrailingComma:true});
 if(errors.length)throw new Error(`Invalid translation file ${file} (offset ${errors[0].offset})`);
 return data;
}
function merge(base,extra){
 const out={...base};
 for(const [key,value] of Object.entries(extra||{}))
  out[key]=value&&typeof value==="object"&&!Array.isArray(value)&&typeof out[key]==="object"?merge(out[key],value):value;
 return out;
}
const de=merge(deLegacy,loadJsonc(deJson,"de/translation.json"));
const en=merge(enLegacy,loadJsonc(enJson,"en/translation.json"));
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
 const locale=language==="en"?"en-US":"de-DE";
 const value=useMemo(()=>({
   language,locale,setLanguage,
   t:(key,paramsOrFallback,fallback)=>{
     const params=paramsOrFallback&&typeof paramsOrFallback==="object"?paramsOrFallback:{};
     const fb=typeof paramsOrFallback==="string"?paramsOrFallback:fallback;
     const template=read(dictionaries[language],key)??read(de,key)??fb??key;
     return typeof template==="string" ? template.replace(/\{(\w+)\}/g,(_,name)=>params[name]??`{${name}}`) : template;
   },
   number:(value,options)=>new Intl.NumberFormat(locale,options).format(value),
   date:(value,options)=>new Intl.DateTimeFormat(locale,options).format(value instanceof Date?value:new Date(value)),
 }),[language,locale]);
 return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(){const value=useContext(I18nContext);if(!value)throw new Error("useI18n requires I18nProvider");return value;}
