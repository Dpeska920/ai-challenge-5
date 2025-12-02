import type { User, UserLimits } from '../../domain/entities/User';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { activateUser } from '../../domain/entities/User';
import { log } from '../../utils/logger';

export interface ActivateUserInput {
  user: User;
  defaultLimits: UserLimits;
}

export interface ActivateUserOutput {
  user: User;
  success: boolean;
}

export class ActivateUserUseCase {
  constructor(private userRepository: UserRepository) {}

  async execute(input: ActivateUserInput): Promise<ActivateUserOutput> {
    const { user, defaultLimits } = input;

    if (user.isActivated) {
      return { user, success: false };
    }

    const activatedUser = activateUser(user, defaultLimits);
    const savedUser = await this.userRepository.update(activatedUser);

    log('info', 'User activated', { telegramId: user.telegramId });

    return { user: savedUser, success: true };
  }
}
