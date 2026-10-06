import { appendTripHistory, recalculateTripMetrics } from "./tripService.js";

const SAME_START_MS = 90_000;
const MAX_JOIN_GAP_MS = 120_000;
const CLOSE_METERS = 250;

function haversine(a, b) {
  const r=6371000, d=Math.PI/180;
  const p1=a.lat*d,p2=b.lat*d,dp=(b.lat-a.lat)*d,dl=(b.lon-a.lon)*d;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function time(v){return new Date(v).getTime();}

async function points(client,id){
  const r=await client.query(`SELECT lat,lon,recorded_at,accuracy_meters,speed_mps
    FROM track_points WHERE trip_id=$1 ORDER BY recorded_at,sequence_number,id`,[id]);
  return r.rows.map(p=>({lat:Number(p.lat),lon:Number(p.lon),recordedAt:p.recorded_at,accuracy:p.accuracy_meters==null?null:Number(p.accuracy_meters)}));
}
function motionStart(trip, pts) {
  const moving=pts.find((p,i)=>i>0 && haversine(pts[Math.max(0,i-1)],p)>=8);
  return moving ? time(moving.recordedAt) : time(trip.started_at);
}
function overlap(a,b){return Math.min(time(a.ended_at),time(b.ended_at))-Math.max(time(a.started_at),time(b.started_at));}
function endpointsClose(a,b){
  if(!a.length||!b.length)return false;
  const pairs=[[a[0],b[0]],[a[a.length-1],b[b.length-1]]];
  return pairs.every(([x,y])=>haversine(x,y)<=CLOSE_METERS);
}
function chainRelated(a,b,ap,bp){
  if(overlap(a,b)>0) return true;
  const first=time(a.started_at)<=time(b.started_at)?{t:a,p:ap}:{t:b,p:bp};
  const second=first.t===a?{t:b,p:bp}:{t:a,p:ap};
  const gap=time(second.t.started_at)-time(first.t.ended_at);
  if(gap<0||gap>MAX_JOIN_GAP_MS||!first.p.length||!second.p.length)return false;
  return haversine(first.p[first.p.length-1],second.p[0])<=CLOSE_METERS;
}

export async function reconcileCompletedTracking(client, tripId) {
  const currentResult=await client.query(`SELECT * FROM trips WHERE id=$1 FOR UPDATE`,[tripId]);
  if(!currentResult.rowCount) return null;
  const current=currentResult.rows[0];
  if(current.status!=="completed"||current.source!=="android") return {action:"none",tripId};

  const candidates=await client.query(`
    SELECT t.*, EXISTS (
      SELECT 1 FROM vehicle_ownership_periods p
      WHERE p.vehicle_id=t.vehicle_id AND p.user_id=t.user_id
        AND t.started_at>=p.valid_from AND (p.valid_to IS NULL OR t.started_at<p.valid_to)
    ) AS is_owner
    FROM trips t
    WHERE t.vehicle_id=$1 AND t.id<>$2 AND t.source='android'
      AND t.status='completed' AND t.archived_at IS NULL
      AND t.reconciliation_status='canonical'
      AND t.started_at <= $4 + interval '2 minutes'
      AND t.ended_at >= $3 - interval '2 minutes'
    ORDER BY t.started_at
    FOR UPDATE`,[current.vehicle_id,current.id,current.started_at,current.ended_at]);
  if(!candidates.rowCount) return {action:"none",tripId};

  const cp=await points(client,current.id);
  const currentOwner=await client.query(`SELECT EXISTS(SELECT 1 FROM vehicle_ownership_periods p
    WHERE p.vehicle_id=$1 AND p.user_id=$2 AND $3>=p.valid_from AND (p.valid_to IS NULL OR $3<p.valid_to)) AS yes`,
    [current.vehicle_id,current.user_id,current.started_at]);
  for(const other of candidates.rows){
    const op=await points(client,other.id);
    if(!chainRelated(current,other,cp,op)) continue;
    const cm=motionStart(current,cp), om=motionStart(other,op);
    const sameStart=Math.abs(cm-om)<=SAME_START_MS;
    const sameRoute=endpointsClose(cp,op);
    if(sameStart&&sameRoute){
      const otherOwner=Boolean(other.is_owner), thisOwner=Boolean(currentOwner.rows[0].yes);
      let winner=current, loser=other;
      if(otherOwner&&!thisOwner){winner=other;loser=current;}
      else if(otherOwner===thisOwner && om<cm){winner=other;loser=current;}
      await client.query(`UPDATE trips SET reconciliation_status='duplicate',canonical_trip_id=$2,
        reconciliation_metadata=jsonb_build_object('reason','same_route','resolvedAt',now()),version=version+1
        WHERE id=$1`,[loser.id,winner.id]);
      await appendTripHistory(client,{tripId:loser.id,userId:loser.user_id,eventType:"TRACK_DUPLICATE",
        metadata:{canonicalTripId:winner.id,reason:"same_route",sameStart}});
      return {action:"duplicate",tripId:winner.id,discardedTripId:loser.id};
    }

    const startsEarlier=cm<om-SAME_START_MS?current:om<cm-SAME_START_MS?other:null;
    const combinedStart=Math.min(time(current.started_at),time(other.started_at));
    const combinedEnd=Math.max(time(current.ended_at),time(other.ended_at));
    const extendsBoth=combinedStart<Math.max(time(current.started_at),time(other.started_at)) &&
      combinedEnd>Math.min(time(current.ended_at),time(other.ended_at));

    if(startsEarlier&&!extendsBoth){
      const loser=startsEarlier.id===current.id?other:current;
      await client.query(`UPDATE trips SET reconciliation_status='duplicate',canonical_trip_id=$2,
        reconciliation_metadata=jsonb_build_object('reason','earlier_driver_wins','resolvedAt',now()),version=version+1
        WHERE id=$1`,[loser.id,startsEarlier.id]);
      await appendTripHistory(client,{tripId:loser.id,userId:loser.user_id,eventType:"TRACK_DUPLICATE",
        metadata:{canonicalTripId:startsEarlier.id,reason:"earlier_driver_wins"}});
      return {action:"duplicate",tripId:startsEarlier.id,discardedTripId:loser.id};
    }

    if(extendsBoth){
      const owner=await client.query(`SELECT user_id FROM vehicle_ownership_periods
        WHERE vehicle_id=$1 AND $2>=valid_from AND (valid_to IS NULL OR $2<valid_to)
        ORDER BY valid_from DESC LIMIT 1`,[current.vehicle_id,new Date(combinedStart)]);
      if(!owner.rowCount) continue;
      const created=await client.query(`INSERT INTO trips(user_id,vehicle_id,type,status,started_at,ended_at,source,completed_at,
        reconciliation_status,reconciliation_metadata)
        VALUES($1,$2,'unclassified','completed',$3,$4,'android',now(),'canonical',
          jsonb_build_object('reason','multi_device_merge','sourceTripIds',jsonb_build_array($5::text,$6::text)))
        RETURNING id`,[owner.rows[0].user_id,current.vehicle_id,new Date(combinedStart),new Date(combinedEnd),current.id,other.id]);
      const mergedId=created.rows[0].id;
      await client.query(`INSERT INTO track_points(trip_id,sequence_number,lat,lon,altitude_meters,accuracy_meters,speed_mps,bearing_degrees,recorded_at)
        SELECT $1,row_number() OVER(ORDER BY recorded_at,accuracy_meters NULLS LAST,id)-1,lat,lon,altitude_meters,accuracy_meters,speed_mps,bearing_degrees,recorded_at
        FROM (SELECT * FROM track_points WHERE trip_id=ANY($2::uuid[])) p`,[mergedId,[current.id,other.id]]);
      await recalculateTripMetrics(client,mergedId);
      for(const src of [current,other]){
        await client.query(`UPDATE trips SET reconciliation_status='merged_source',canonical_trip_id=$2,
          reconciliation_metadata=jsonb_build_object('reason','multi_device_merge','resolvedAt',now()),version=version+1 WHERE id=$1`,[src.id,mergedId]);
        await appendTripHistory(client,{tripId:src.id,userId:src.user_id,eventType:"TRACK_RECONCILED",
          metadata:{canonicalTripId:mergedId,reason:"multi_device_merge",ownerUserId:owner.rows[0].user_id}});
      }
      await appendTripHistory(client,{tripId:mergedId,userId:owner.rows[0].user_id,eventType:"TRACK_RECONCILED",
        metadata:{sourceTripIds:[current.id,other.id],reason:"multi_device_merge",splitRecommended:true}});
      return {action:"merged",tripId:mergedId,sourceTripIds:[current.id,other.id],splitRecommended:true};
    }
  }
  return {action:"none",tripId};
}
