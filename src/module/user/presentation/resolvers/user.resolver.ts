import { Inject } from '@nestjs/common';
import { Args, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { Public } from '../../../../core/decorators';

import { IProfileService, IUserService, PROFILE_SERVICE_PROVIDER, USER_SERVICE_PROVIDER } from '../../domain';
import { ProfileSchema, UserSchema } from '../schemas';

@Resolver(() => UserSchema)
export class UserResolver {
  constructor(
    @Inject(USER_SERVICE_PROVIDER)
    private readonly userService: IUserService,

    @Inject(PROFILE_SERVICE_PROVIDER)
    private readonly profileService: IProfileService,
  ) {}

  @Public()
  @Query(() => UserSchema, { name: 'user' })
  async fetchUser(@Args('id') id: string): Promise<UserSchema> {
    return this.userService.fetchUser(id);
  }

  @Public()
  @Query(() => [UserSchema], { name: 'users' })
  async fetchUsers(): Promise<UserSchema[]> {
    return this.userService.fetchUsers();
  }

  @Public()
  @ResolveField(() => ProfileSchema, { name: 'profile', nullable: true })
  async fetchProfile(@Parent() user: UserSchema): Promise<ProfileSchema | null> {
    return this.profileService.fetchUserProfile(user.id);
  }
}
