import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateMemberDto, UpdateMemberDto } from './dto/member.dto';
import { MembersService } from './members.service';

@Controller()
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  /* ---- public ---- */

  @Public()
  @Get('news/members')
  findPublic() {
    return this.membersService.findAll();
  }

  /* ---- admin ---- */

  @Get('admin/members')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findAll() {
    return this.membersService.findAll();
  }

  @Get('admin/members/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findOne(@Param('id') id: string) {
    return this.membersService.findOne(id);
  }

  @Post('admin/members')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  create(@Body() dto: CreateMemberDto) {
    return this.membersService.create(dto);
  }

  @Patch('admin/members/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.membersService.update(id, dto);
  }

  @Delete('admin/members/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
  remove(@Param('id') id: string) {
    return this.membersService.remove(id);
  }
}
