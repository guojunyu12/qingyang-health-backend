import {pool} from '../../common/database.js';
import {recognitionWorker} from './runtime.js';

/** Reload trusted event data; queue payloads cannot select an arbitrary photo/user. */
export async function consumeRecognitionEvent(outboxId:string,worker=recognitionWorker()) {
 const [rows]=await pool.execute<any[]>('SELECT event_type,aggregate_id,payload FROM outbox_events WHERE id=?',[outboxId]);
 const row=rows[0],payload=typeof row?.payload==='string'?JSON.parse(row.payload):row?.payload;
 if(row?.event_type!=='nutrition.recognition.requested.v1'||row.aggregate_id!==payload?.jobId)throw Error('INVALID_EVENT');
 const [jobs]=await pool.execute<any[]>('SELECT user_id,asset_id FROM recognition_jobs WHERE id=?',[payload.jobId]);
 if(!jobs.length||jobs[0].user_id!==payload.userId||jobs[0].asset_id!==payload.assetId)throw Error('INVALID_EVENT');
 if(!worker){
  await pool.execute("UPDATE recognition_jobs SET status='failed',error_code='RECOGNITION_NOT_CONFIGURED',completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='queued'",[payload.jobId]);
  return;
 }
 await worker.run(payload.jobId);
}
