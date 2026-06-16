import { Inject, Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const ROLES = ['admin', 'operator', 'viewer'];

@Injectable()
export class UsersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list() {
    return this.pool
      .query('SELECT id, email, role, created_at FROM users ORDER BY created_at')
      .then((r) => r.rows);
  }

  async create(email: string, password: string, role: string) {
    if (!ROLES.includes(role)) throw new BadRequestException('Invalid role');
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3)
         RETURNING id, email, role, created_at`,
        [email, hash, role],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Email already exists');
      throw e;
    }
  }

  async setRole(id: string, role: string) {
    if (!ROLES.includes(role)) throw new BadRequestException('Invalid role');
    const { rows } = await this.pool.query(
      'UPDATE users SET role=$2 WHERE id=$1 RETURNING id, email, role',
      [id, role],
    );
    if (!rows[0]) throw new NotFoundException('User not found');
    return rows[0];
  }

  async setPassword(id: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await this.pool.query(
      'UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id, email, role',
      [id, hash],
    );
    if (!rows[0]) throw new NotFoundException('User not found');
    return rows[0];
  }

  async remove(id: string, actingUserId: string) {
    if (id === actingUserId) throw new BadRequestException('You cannot delete your own account');
    // Prevent removing the last admin.
    const { rows: admins } = await this.pool.query(
      `SELECT count(*)::int AS c FROM users WHERE role='admin'`,
    );
    const { rows: target } = await this.pool.query('SELECT role FROM users WHERE id=$1', [id]);
    if (!target[0]) throw new NotFoundException('User not found');
    if (target[0].role === 'admin' && admins[0].c <= 1) {
      throw new BadRequestException('Cannot delete the last admin');
    }
    await this.pool.query('DELETE FROM users WHERE id=$1', [id]);
    return { deleted: id };
  }

  async audit(userId: string | null, action: string, target: string, detail: any) {
    await this.pool.query(
      'INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1,$2,$3,$4)',
      [userId, action, target, detail ? JSON.stringify(detail) : null],
    );
  }
}
