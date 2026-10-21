import type {SqlTx,UUID} from './shared';
// Local compatibility extensions; do not mutate the frozen QY-MYSQL-1.0.0 contract.
export const M05_NOTIFICATION_TYPES=['booking_confirmed','booking_canceled','activity_canceled','redemption_result','operations_message'] as const;
export type M05NotificationType=typeof M05_NOTIFICATION_TYPES[number];
export interface NotificationInput {userId:UUID;type:M05NotificationType;title:string;body:string;actionPath:string;eventKey:string;}
export interface NotificationsPort {
 readonly mode:'local_in_app'|'external';
 createInTransaction(tx:SqlTx,input:NotificationInput):Promise<{id:UUID}>;
}
export interface CampaignRequestedEvent {eventType:'m05.message.campaign.requested.v1';payload:{campaignId:UUID;campaignVersion:number};}
