import { Router } from "express";
import { pool } from "../database/pool.js";
import { badRequest, notFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uuidValue } from "../lib/validation.js";

export const placeRoutes = Router();
placeRoutes.use(requireAuth);

function parse(body) {
  const name=String(body?.name||"").trim();
  const latitude=Number(body?.latitude), longitude=Number(body?.longitude);
  const radius=body?.radiusMeters == null ? null : Number(body.radiusMeters);
  const type=body?.suggestedType || null;
  if(!name || name.length>120 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
     !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
     (radius != null && (!Number.isInteger(radius) || radius<25 || radius>5000)) ||
     (type && !["business","private","commute","unclassified"].includes(type))) {
    throw badRequest("VALIDATION_ERROR","Der gespeicherte Ort ist ungültig.");
  }
  return {name,address:String(body?.address||"").trim()||null,latitude,longitude,radius,
    type,purpose:String(body?.purpose||"").trim()||null,contact:String(body?.contact||"").trim()||null};
}
const map=(r)=>({id:r.id,name:r.name,address:r.address,latitude:Number(r.latitude),longitude:Number(r.longitude),
 radiusMeters:r.radius_meters,suggestedType:r.suggested_type,purpose:r.purpose,contact:r.contact});

placeRoutes.get("/",asyncHandler(async(req,res)=>{
 const r=await pool.query(`SELECT * FROM saved_places WHERE user_id=$1 ORDER BY lower(name)`,[req.auth.userId]);
 res.json(r.rows.map(map));
}));
placeRoutes.post("/",asyncHandler(async(req,res)=>{
 const p=parse(req.body);
 const r=await pool.query(`INSERT INTO saved_places(user_id,name,address,latitude,longitude,radius_meters,suggested_type,purpose,contact)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
 [req.auth.userId,p.name,p.address,p.latitude,p.longitude,p.radius,p.type,p.purpose,p.contact]);
 res.status(201).json(map(r.rows[0]));
}));
placeRoutes.put("/:id",asyncHandler(async(req,res)=>{
 const id=uuidValue(req.params.id),p=parse(req.body);
 const r=await pool.query(`UPDATE saved_places SET name=$3,address=$4,latitude=$5,longitude=$6,radius_meters=$7,
 suggested_type=$8,purpose=$9,contact=$10 WHERE id=$1 AND user_id=$2 RETURNING *`,
 [id,req.auth.userId,p.name,p.address,p.latitude,p.longitude,p.radius,p.type,p.purpose,p.contact]);
 if(!r.rowCount) throw notFound("PLACE_NOT_FOUND","Der Ort wurde nicht gefunden.");
 res.json(map(r.rows[0]));
}));
placeRoutes.delete("/:id",asyncHandler(async(req,res)=>{
 const r=await pool.query(`DELETE FROM saved_places WHERE id=$1 AND user_id=$2`,[uuidValue(req.params.id),req.auth.userId]);
 if(!r.rowCount) throw notFound("PLACE_NOT_FOUND","Der Ort wurde nicht gefunden.");
 res.status(204).end();
}));
