import type { User } from '../../domain/entities/User';
import type { LimitCheckResult } from '../../domain/entities/User';
import { LimitService } from '../../domain/services/LimitService';

export interface CheckLimitsInput {
  user: User;
}

export interface CheckLimitsOutput {
  user: User;
  checkResult: LimitCheckResult;
}

export class CheckLimitsUseCase {
  constructor(private limitService: LimitService) {}

  async execute(input: CheckLimitsInput): Promise<CheckLimitsOutput> {
    const { user } = input;
    return this.limitService.checkAndResetLimits(user);
  }
}
