import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../common/permissions';
import {
  CreateUserDto,
  SetRolesDto,
  SetPasswordDto,
  SetStatusDto,
  SetUsernameDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@Controller('admin/users')
@Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(RoleName.SUPER_ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Delete(':id')
  @Roles(RoleName.SUPER_ADMIN)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    if (id === actor.id) {
      throw new NotFoundException('Không thể xóa tài khoản đang đăng nhập');
    }
    return this.usersService.remove(id);
  }

  @Patch(':id/roles')
  @Roles(RoleName.SUPER_ADMIN)
  async setRoles(
    @Param('id') id: string,
    @Body() dto: SetRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    if (id === actor.id) {
      throw new NotFoundException('Không thể thay đổi vai trò của chính mình');
    }
    return this.usersService.setRoles(id, dto);
  }

  @Patch(':id/password')
  setPassword(
    @Param('id') id: string,
    @Body() dto: SetPasswordDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.setPassword(id, dto, actor);
  }

  @Patch(':id/username')
  setUsername(@Param('id') id: string, @Body() dto: SetUsernameDto) {
    return this.usersService.setUsername(id, dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.usersService.setStatus(id, dto);
  }
}
