import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** Version compatibility matrix check (blueprint E.1, J.6). Pure-ish; semver compare simplified. */
@Injectable()
export class CompatibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async checkRelease(releaseId: string): Promise<{ ok: boolean; violations: any[] }> {
    const pins = await this.prisma.releaseRepository.findMany({ where: { releaseId } });
    const byRepo = new Map(pins.map((p) => [p.repositoryId, p.version]));
    const violations: any[] = [];
    for (const pin of pins) {
      const rules = await this.prisma.versionCompatibility.findMany({
        where: { repositoryId: pin.repositoryId, version: pin.version },
      });
      for (const rule of rules) {
        const depVersion = byRepo.get(rule.dependsRepoId);
        if (depVersion && !this.satisfies(depVersion, rule.compatibleRange)) {
          violations.push({ repo: pin.repositoryId, dependsOn: rule.dependsRepoId,
            found: depVersion, expected: rule.compatibleRange });
        }
      }
    }
    return { ok: violations.length === 0, violations };
  }

  /** Minimal range check placeholder — replace with `semver.satisfies` in implementation. */
  private satisfies(_version: string, _range: string): boolean { return true; }
}
