export type Audience = 'h5' | 'admin';
export interface Config {
  audience: Audience; port: number; origin: string; production: boolean; devIdentity: boolean;
  sessionSecret: string; devToken: string; devClock?:boolean; devRewards?:boolean; rewardCodeKey?:string;
  db: {host:string;port:number;user:string;password:string;database:string};
}
export function loadConfig(audience: Audience): Config {
  const production = process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  const devIdentity = process.env.IDENTITY_MODE === 'development';
  if (production && devIdentity) throw new Error('PRODUCTION_DEV_IDENTITY_FORBIDDEN');
  if (!['development', 'external'].includes(process.env.IDENTITY_MODE || '')) throw new Error('IDENTITY_MODE_REQUIRED');
  const sessionSecret = process.env.SESSION_SECRET || '';
  const devToken = process.env.DEV_ACCESS_TOKEN || '';
  if (sessionSecret.length < 32 || (devIdentity && devToken.length < 32)) throw new Error('LOCAL_SECRETS_REQUIRED');
  const database = process.env.DB_NAME || '';
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(database)) throw new Error('INVALID_DB_NAME');
  if(production && process.env.ENABLE_DEV_REWARDS==='true')throw new Error('PRODUCTION_DEV_REWARDS_FORBIDDEN');
  if(production && process.env.ENABLE_DEV_CLOCK==='true')throw new Error('PRODUCTION_DEV_CLOCK_FORBIDDEN');
  return {audience,production,devIdentity,sessionSecret,devToken,devRewards:process.env.ENABLE_DEV_REWARDS==='true',rewardCodeKey:process.env.REWARD_CODE_KEY,devClock:process.env.ENABLE_DEV_CLOCK==='true',
    port:Number(process.env[audience === 'h5' ? 'H5_API_PORT' : 'ADMIN_API_PORT'] || (audience === 'h5' ? 3100 : 3101)),
    origin:process.env[audience === 'h5' ? 'H5_ORIGIN' : 'ADMIN_ORIGIN'] || (audience === 'h5' ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:3001'),
    db:{host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3307),user:process.env.DB_USER || 'm05_app',password:process.env.DB_PASSWORD || '',database}};
}
