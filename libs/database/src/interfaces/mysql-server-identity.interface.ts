export interface MysqlServerIdentity {
  '@@server_uuid': string;
  '@@hostname': string;
  '@@read_only': 0 | 1;
}
