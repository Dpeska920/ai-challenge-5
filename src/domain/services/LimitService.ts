import type { User, LimitCheckResult } from '../entities/User';
import type { UserRepository } from '../repositories/UserRepository';
import {
  checkLimits,
  shouldResetDaily,
  shouldResetMonthly,
  resetDailyUsage,
  resetMonthlyUsage,
  incrementUsage,
} from '../entities/User';

export class LimitService {
  constructor(private userRepository: UserRepository) {}

  async checkAndResetLimits(user: User): Promise<{ user: User; checkResult: LimitCheckResult }> {
    let updatedUser = user;

    // Reset daily usage if needed
    if (shouldResetDaily(updatedUser)) {
      updatedUser = resetDailyUsage(updatedUser);
      updatedUser = await this.userRepository.update(updatedUser);
    }

    // Reset monthly usage if needed
    if (shouldResetMonthly(updatedUser)) {
      updatedUser = resetMonthlyUsage(updatedUser);
      updatedUser = await this.userRepository.update(updatedUser);
    }

    const checkResult = checkLimits(updatedUser);

    return { user: updatedUser, checkResult };
  }

  async incrementAndSave(user: User): Promise<User> {
    const updatedUser = incrementUsage(user);
    return this.userRepository.update(updatedUser);
  }

  formatLimitError(checkResult: LimitCheckResult): string {
    switch (checkResult.reason) {
      case 'daily':
        return `You have reached your daily limit (${checkResult.used}/${checkResult.limit}). Try again tomorrow.`;
      case 'monthly':
        return `You have reached your monthly limit (${checkResult.used}/${checkResult.limit}). Try again next month.`;
      case 'total':
        return `You have reached your total usage limit (${checkResult.used}/${checkResult.limit}).`;
      default:
        return 'Usage limit exceeded.';
    }
  }

  formatUsageStatus(user: User): string {
    const { limits, usage } = user;
    const lines: string[] = ['Usage Status:'];

    if (limits.daily !== null) {
      lines.push(`  Daily: ${usage.dailyUsed}/${limits.daily}`);
    } else {
      lines.push(`  Daily: ${usage.dailyUsed} (unlimited)`);
    }

    if (limits.monthly !== null) {
      lines.push(`  Monthly: ${usage.monthlyUsed}/${limits.monthly}`);
    } else {
      lines.push(`  Monthly: ${usage.monthlyUsed} (unlimited)`);
    }

    if (limits.total !== null) {
      lines.push(`  Total: ${usage.totalUsed}/${limits.total}`);
    } else {
      lines.push(`  Total: ${usage.totalUsed} (unlimited)`);
    }

    return lines.join('\n');
  }
}
