export interface Env {
  OMNIGENT_SESSION: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  SERVER_URL: string;
}
