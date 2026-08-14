export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: {
    url: string;
  };
  corsOrigins: string[];
}
