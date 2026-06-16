import { Global, Module, Logger } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

const poolProvider = {
  provide: PG_POOL,
  useFactory: () => {
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://monitor:monitor@localhost:5432/monitoring',
      max: 20,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) =>
      new Logger('PgPool').error('Idle client error', err.message),
    );
    return pool;
  },
};

@Global()
@Module({
  providers: [poolProvider],
  exports: [poolProvider],
})
export class DatabaseModule {}
