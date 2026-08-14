import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { LessThan, Repository } from 'typeorm';
import { StepUpToken } from './entities/step-up-token.entity';

const STEP_UP_TOKEN_TTL_MS = 2 * 60_000; // دقيقتين بس — "حديث فعلاً" مش "حديث نسبيًا" (ADR-0011 §4)

// معرّف صف حقيقي في Postgres، مش JWT ومش Redis key — استهلاك مرة واحدة لازم يكون fail-closed
// (راجع "البدائل اللي اتقيّمت" في ADR-0011: Redis فشله بيترجم "miss آمن" = ثغرة إعادة استخدام).
@Injectable()
export class StepUpService {
  constructor(@InjectRepository(StepUpToken) private readonly tokens: Repository<StepUpToken>) {}

  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + STEP_UP_TOKEN_TTL_MS);
    const row = await this.tokens.save(this.tokens.create({ userId, expiresAt }));
    return { token: row.id, expiresAt };
  }

  /** استهلاك ذرّي مرة واحدة — UPDATE ... WHERE used_at IS NULL بدل SELECT-then-UPDATE، عشان يكون atomic حقيقي بدون transaction/قفل إضافي. */
  async consume(userId: string, tokenId: string): Promise<boolean> {
    const result = await this.tokens
      .createQueryBuilder()
      .update(StepUpToken)
      .set({ usedAt: () => 'now()' })
      .where('id = :tokenId', { tokenId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > now()')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async purgeExpired(): Promise<number> {
    const result = await this.tokens.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
