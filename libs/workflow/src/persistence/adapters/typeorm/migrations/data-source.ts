import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { WORKFLOW_TYPEORM_ENTITIES } from '../entities';

config();

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'workflow',
  entities: [...WORKFLOW_TYPEORM_ENTITIES],
  migrations: [`${__dirname}/*.migration.{ts,js}`],
  synchronize: false,
});
