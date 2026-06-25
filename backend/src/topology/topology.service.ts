import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export const ENVIRONMENTS = ['dev', 'qa', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

const NODE_TYPES = ['ip', 'loadbalancer', 'server', 'db', 'client', 'firewall'];
const EMPTY_GRAPH = { nodes: [], edges: [] };

export interface TopoNode {
  id: string;
  type: string;
  label?: string;
  ip?: string;
  x: number;
  y: number;
}
export interface TopoEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}
export interface Graph {
  nodes: TopoNode[];
  edges: TopoEdge[];
}

@Injectable()
export class TopologyService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private assertEnv(env: string): asserts env is Environment {
    if (!ENVIRONMENTS.includes(env as Environment)) {
      throw new BadRequestException(
        `environment must be one of: ${ENVIRONMENTS.join(', ')}`,
      );
    }
  }

  /** Validate + normalise an incoming graph so the canvas always loads cleanly. */
  private sanitize(graph: any): Graph {
    if (!graph || typeof graph !== 'object') return { ...EMPTY_GRAPH };
    const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

    const nodes: TopoNode[] = rawNodes
      .filter((n: any) => n && typeof n.id === 'string')
      .map((n: any) => ({
        id: String(n.id),
        type: NODE_TYPES.includes(n.type) ? n.type : 'server',
        label: typeof n.label === 'string' ? n.label.slice(0, 120) : '',
        ip: typeof n.ip === 'string' ? n.ip.slice(0, 64) : '',
        x: Number.isFinite(n.x) ? Number(n.x) : 0,
        y: Number.isFinite(n.y) ? Number(n.y) : 0,
      }));

    const ids = new Set(nodes.map((n) => n.id));
    const edges: TopoEdge[] = rawEdges
      .filter(
        (e: any) =>
          e &&
          typeof e.id === 'string' &&
          ids.has(String(e.from)) &&
          ids.has(String(e.to)) &&
          e.from !== e.to,
      )
      .map((e: any) => ({
        id: String(e.id),
        from: String(e.from),
        to: String(e.to),
        label: typeof e.label === 'string' ? e.label.slice(0, 80) : '',
      }));

    return { nodes, edges };
  }

  /** Graph for a product+env. Returns an empty graph if none saved yet. */
  async get(productId: string, env: string): Promise<Graph> {
    this.assertEnv(env);
    const { rows } = await this.pool.query(
      `SELECT graph FROM topologies WHERE product_id = $1 AND environment = $2`,
      [productId, env],
    );
    return rows[0]?.graph ?? { ...EMPTY_GRAPH };
  }

  /** Every saved environment for a product (for showing which tabs have data). */
  async listEnvs(productId: string) {
    const { rows } = await this.pool.query(
      `SELECT environment,
              jsonb_array_length(COALESCE(graph->'nodes','[]'::jsonb)) AS node_count,
              updated_at
         FROM topologies WHERE product_id = $1`,
      [productId],
    );
    return rows;
  }

  /** Upsert the graph for a product+env. */
  async save(productId: string, env: string, graph: any, updatedBy?: string) {
    this.assertEnv(env);

    const prod = await this.pool.query(
      `SELECT id FROM products WHERE id = $1`,
      [productId],
    );
    if (!prod.rows[0]) throw new NotFoundException('Product not found');

    const clean = this.sanitize(graph);
    const { rows } = await this.pool.query(
      `INSERT INTO topologies (product_id, environment, graph, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (product_id, environment)
       DO UPDATE SET graph = EXCLUDED.graph,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()
       RETURNING graph, updated_at, updated_by`,
      [productId, env, JSON.stringify(clean), updatedBy ?? null],
    );
    return rows[0];
  }
}
