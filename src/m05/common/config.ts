export type Audience = "h5" | "admin";
export interface Config {
  audience: Audience;
  port: number;
  origin: string;
  production: boolean;
  devIdentity: false;
  sessionSecret: string;
  devToken: string;
  devClock?: boolean;
  devRewards?: boolean;
  rewardCodeKey?: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}
