import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {uuid} from '../activities/model';
import {requireValue} from '../../common/errors';
export class NotificationFailures {
 private path:string;constructor(database:string){mkdirSync(resolve('.runtime'),{recursive:true});this.path=resolve('.runtime','notification-failures-'+database+'.json');}
 get():string[]{return existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')).failedUserIds:[];}
 set(ids:unknown){requireValue(Array.isArray(ids)&&ids.length<=100,422,'INVALID_RECIPIENTS','最多指定 100 名测试用户');const value={failedUserIds:[...new Set(ids.map(uuid))]},temp=this.path+'.'+randomUUID();writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,this.path);return value;}
 assert(userId:string){requireValue(!this.get().includes(userId),503,'DEV_NOTIFICATION_FAILURE','开发场景：本地收件箱写入失败');}
}
