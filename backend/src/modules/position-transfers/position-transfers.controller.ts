import {
  Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { PositionTransfersService, InitiateTransferDto } from './position-transfers.service';

@Controller('api/position-transfers')
@UseGuards(AuthGuard, RoleGuard)
export class PositionTransfersController {
  constructor(private svc: PositionTransfersService) {}

  // 现场主管/企业发起岗位临时调换（须说明强度、风险、工资差异）
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post()
  initiate(@Req() req: any, @Body() dto: InitiateTransferDto) {
    return this.svc.initiate(req.user, dto);
  }

  // 工人确认：保险范围与工时单同步更新；未确认已作业时段标为争议工时
  @Roles('WORKER')
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.svc.confirm(req.user.sub, Number(id));
  }

  // 工人拒绝：记录原因，平台判定企业是否仍需支付到场补偿
  @Roles('WORKER')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Req() req: any, @Body() dto: { reason: string }) {
    return this.svc.reject(req.user.sub, Number(id), dto.reason);
  }

  // 主管登记工人拒绝后是否继续从事原岗位（到场补偿复核改判）
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post(':id/compensation')
  compensation(@Param('id') id: string, @Req() req: any, @Body() dto: { continued: boolean; note?: string }) {
    return this.svc.resolveCompensation(req.user, Number(id), !!dto.continued, dto.note);
  }

  // 某任务的全部岗位调换记录
  @Get('assignment/:id')
  byAssignment(@Param('id') id: string) {
    return this.svc.listByAssignment(Number(id));
  }

  // 工人端：待我确认的岗位调换（用于任务列表提醒）
  @Roles('WORKER')
  @Get('mine/pending')
  mine(@Req() req: any) {
    return this.svc.pendingForWorker(req.user.sub);
  }

  // 主管/企业现场工作台：本企业岗位调换跟进单
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Get('board')
  board(@Req() req: any) {
    return this.svc.boardForEnterprise(req.user.enterpriseId);
  }
}
